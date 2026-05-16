import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import dotenv from "dotenv";
import { Dropbox } from "dropbox";
import fetch from "node-fetch";
import fs from "fs-extra";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(express.static("."));

const PORT = process.env.PORT || 3000;

const PROPERTIES_FILE = "./properties.json";
const APPLICATIONS_FILE = "./applications.json";

const dbx = new Dropbox({
  accessToken: process.env.DROPBOX_ACCESS_TOKEN,
  fetch
});

async function ensureFiles() {
  if (!(await fs.pathExists(PROPERTIES_FILE))) {
    await fs.writeJson(PROPERTIES_FILE, [], { spaces: 2 });
  }

  if (!(await fs.pathExists(APPLICATIONS_FILE))) {
    await fs.writeJson(APPLICATIONS_FILE, [], { spaces: 2 });
  }
}

function makeCode() {
  return "OV-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function cleanName(value) {
  return String(value || "Unknown")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .trim();
}

function checkAdminPassword(req, res, next) {
  const password = req.headers["x-admin-password"];

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: "ADMIN_PASSWORD is missing"
    });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      error: "Wrong admin password"
    });
  }

  next();
}

app.get("/api/properties", checkAdminPassword, async (req, res) => {
  await ensureFiles();

  const properties = await fs.readJson(PROPERTIES_FILE);

  res.json({
    success: true,
    properties
  });
});

app.post("/api/properties", checkAdminPassword, async (req, res) => {
  await ensureFiles();

  const properties = await fs.readJson(PROPERTIES_FILE);

  const newProperty = {
    id: Date.now().toString(),
    propertyName: req.body.propertyName || "",
    address: req.body.address || "",
    defaultRent: req.body.defaultRent || "",
    defaultDeposit: req.body.defaultDeposit || "",
    defaultApplicationFee: req.body.defaultApplicationFee || "",
    defaultPetsAllowed: req.body.defaultPetsAllowed || "No",
    defaultPetDeposit: req.body.defaultPetDeposit || "",
    notes: req.body.notes || "",
    createdAt: new Date().toISOString()
  };

  properties.push(newProperty);

  await fs.writeJson(PROPERTIES_FILE, properties, { spaces: 2 });

  res.json({
    success: true,
    property: newProperty
  });
});

app.put("/api/properties/:id", checkAdminPassword, async (req, res) => {
  await ensureFiles();

  const properties = await fs.readJson(PROPERTIES_FILE);

  const index = properties.findIndex(p => p.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({
      success: false,
      error: "Property not found"
    });
  }

  properties[index] = {
    ...properties[index],
    propertyName: req.body.propertyName || "",
    address: req.body.address || "",
    defaultRent: req.body.defaultRent || "",
    defaultDeposit: req.body.defaultDeposit || "",
    defaultApplicationFee: req.body.defaultApplicationFee || "",
    defaultPetsAllowed: req.body.defaultPetsAllowed || "No",
    defaultPetDeposit: req.body.defaultPetDeposit || "",
    notes: req.body.notes || "",
    updatedAt: new Date().toISOString()
  };

  await fs.writeJson(PROPERTIES_FILE, properties, { spaces: 2 });

  res.json({
    success: true,
    property: properties[index]
  });
});

app.delete("/api/properties/:id", checkAdminPassword, async (req, res) => {
  await ensureFiles();

  let properties = await fs.readJson(PROPERTIES_FILE);

  properties = properties.filter(p => p.id !== req.params.id);

  await fs.writeJson(PROPERTIES_FILE, properties, { spaces: 2 });

  res.json({
    success: true
  });
});

app.post("/api/application-links", checkAdminPassword, async (req, res) => {
  await ensureFiles();

  const applications = await fs.readJson(APPLICATIONS_FILE);

  const code = makeCode();

  const newApplication = {
    code,
    propertyId: req.body.propertyId || "",
    propertyName: req.body.propertyName || "",
    address: req.body.address || "",
    tenantEmail: req.body.tenantEmail || "",
    rent: req.body.rent || "",
    availableDate: req.body.availableDate || "",
    deposit: req.body.deposit || "",
    applicationFee: req.body.applicationFee || "",
    petsAllowed: req.body.petsAllowed || "No",
    petDeposit: req.body.petDeposit || "",
    notes: req.body.notes || "",
    status: "Open",
    createdAt: new Date().toISOString()
  };

  applications.push(newApplication);

  await fs.writeJson(APPLICATIONS_FILE, applications, { spaces: 2 });

  res.json({
    success: true,
    application: newApplication
  });
});

app.get("/api/application/:code", async (req, res) => {
  await ensureFiles();

  const applications = await fs.readJson(APPLICATIONS_FILE);

  const application = applications.find(
    app => app.code === req.params.code && app.status === "Open"
  );

  if (!application) {
    return res.status(404).json({
      success: false,
      error: "Application link not found or closed"
    });
  }

  res.json({
    success: true,
    application
  });
});

app.post("/submit-application", async (req, res) => {
  try {
    await ensureFiles();

    const code = req.body.applicationCode || "";
    const applications = await fs.readJson(APPLICATIONS_FILE);

    const savedApplication = applications.find(app => app.code === code);

    const applicantName =
      cleanName(
        req.body["Applicant 1 First Name"] + " " + req.body["Applicant 1 Last Name"]
      ) || "Unknown Applicant";

    const property =
      cleanName(
        req.body.property ||
        req.body.propertyName ||
        savedApplication?.propertyName ||
        "Unknown Property"
      );

    const folderName =
      `/Rental Applications/${property}/${code || Date.now()}-${applicantName}`;

    await dbx.filesCreateFolderV2({
      path: folderName,
      autorename: true
    });

    const fieldsFile = Buffer.from(
      JSON.stringify(req.body, null, 2)
    );

    await dbx.filesUpload({
      path: `${folderName}/application.json`,
      contents: fieldsFile
    });

    if (req.files) {
      for (const key in req.files) {
        const file = req.files[key];

        if (Array.isArray(file)) {
          for (const item of file) {
            const safeName = item.name.replace(/[^a-zA-Z0-9._-]/g, "_");

            await dbx.filesUpload({
              path: `${folderName}/${safeName}`,
              contents: item.data
            });
          }
        } else {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

          await dbx.filesUpload({
            path: `${folderName}/${safeName}`,
            contents: file.data
          });
        }
      }
    }

    if (savedApplication) {
      savedApplication.status = "Submitted";
      savedApplication.submittedAt = new Date().toISOString();
      savedApplication.dropboxFolder = folderName;

      await fs.writeJson(APPLICATIONS_FILE, applications, { spaces: 2 });
    }

    res.json({
      success: true,
      dropboxFolder: folderName
    });

  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

ensureFiles().then(() => {
  app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
  });
});
