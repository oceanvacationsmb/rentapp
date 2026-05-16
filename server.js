import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import dotenv from "dotenv";
import { Dropbox } from "dropbox";
import fetch from "node-fetch";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(fileUpload());

app.use(express.static("."));

const dbx = new Dropbox({
  accessToken: process.env.DROPBOX_ACCESS_TOKEN,
  fetch
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_TO,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

app.post("/submit-application", async (req, res) => {

  try {

    const applicantName =
      req.body.applicantName || "Unknown Applicant";

    const property =
      req.body.property || "Unknown Property";

    const folderName =
      `/Rental Applications/${property}/${Date.now()}-${applicantName}`;

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

        const safeName =
          file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

        await dbx.filesUpload({
          path: `${folderName}/${safeName}`,
          contents: file.data
        });
      }
    }

    await transporter.sendMail({
      from: process.env.EMAIL_TO,
      to: process.env.EMAIL_TO,
      subject: "New Rental Application Submitted",
      text:
`A new rental application was submitted.

Applicant:
${applicantName}

Property:
${property}

Dropbox Folder:
${folderName}`
    });

    res.json({
      success: true
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(3000, () => {

  console.log("Server running on port 3000");

});
