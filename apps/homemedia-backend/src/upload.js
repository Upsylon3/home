// Uploading from inside HomeMedia. The files are stored by HomeCloud (the
// one place bytes live — see homecloudClient.js); this just gives the
// gallery its own "add photos" button instead of sending people over to
// HomeCloud to do it.
//
// Nothing here widens what a person can do: the request is forwarded with
// THEIR token, so HomeCloud applies the same login check, the same quota
// and the same 1 GB limit as for an upload made in HomeCloud itself. A
// non-media file sent here would simply be stored and never shown in the
// library; the frontend's file picker only offers media in the first place.
const express = require("express");
const { asyncHandler } = require("./asyncHandler");
const { ensureRootFolder, forwardUpload } = require("./homecloudClient");

const router = express.Router();

// Where HomeMedia uploads land in HomeCloud. One tidy folder instead of the
// HomeCloud root, so a phone's worth of photos doesn't bury everything else.
// The library lists media from EVERY folder, so moving a file elsewhere in
// HomeCloud later doesn't make it vanish from HomeMedia.
const UPLOAD_FOLDER_NAME = "HomeMedia";

// The frontend asks once per batch, then includes the id as a normal form
// field ("folderId") in each upload, which HomeCloud already understands.
router.get(
  "/upload-folder",
  asyncHandler(async (req, res) => {
    res.json({ folderId: await ensureRootFolder(req.token, UPLOAD_FOLDER_NAME) });
  })
);

router.post(
  "/upload",
  asyncHandler(async (req, res) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return res.status(400).json({ error: "Send the file as multipart/form-data." });
    }

    let upstream;
    try {
      upstream = await forwardUpload(req.token, req, contentType);
    } catch {
      return res.status(502).json({ error: "Couldn't reach HomeCloud to store the upload." });
    }

    // Relay HomeCloud's answer as-is (201 + the new file, or its own
    // 413 "over quota" / 400 message) so the frontend can show the real reason.
    const data = await upstream.json().catch(() => null);
    res.status(upstream.status).json(data || { error: "HomeCloud sent an unreadable reply." });
  })
);

module.exports = router;
