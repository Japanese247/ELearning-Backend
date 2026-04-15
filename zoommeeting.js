const  axios = require("axios");
const dotenv =  require("dotenv");
const btoa = require("btoa");
const crypto = require("crypto");
const logger = require("./utils/Logger");
dotenv.config();

const auth_token_url = "https://zoom.us/oauth/token";
const api_base_url = "https://api.zoom.us/v2";

const ENC_KEY = process.env.TOKEN_ENC_KEY; // must be 32 chars
const IV_LENGTH = 16; // AES block size

// 🔐 Encrypt function
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENC_KEY), iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return iv.toString("hex") + ":" + authTag + ":" + encrypted;
}

// 🔐 Decrypt function
function decrypt(encryptedString) {
    const parts = encryptedString.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format for GCM");
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

// New Code for creating meeting using teachers token
const refreshZoomToken = async (refresh_token) => {
  try {
    const clientId = process.env.ZOOM_clientId;
    const clientSecret = process.env.ZOOM_clientSecret;
    const base64 = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const res = await axios.post(
      `${auth_token_url}?grant_type=refresh_token&refresh_token=${refresh_token}`,
      {},
      {
        headers: { Authorization: `Basic ${base64}` },
      }
    );

    return {
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
    };
  } catch (err) {
    logger.error("Error refreshing Zoom token:", JSON.stringify(err.response?.data || err.message));
    console.error("Error refreshing Zoom token:", JSON.stringify(err.response?.data || err.message));
    return null;
  }
};

/**
 * Creates a Zoom meeting using teacher’s OAuth access token
 */
const createZoomMeeting = async (meetingDetails, teacherData, TeacherModel) => {
  try {
    let access_token = decrypt(teacherData.access_token);

    // Test if token works
    let tokenValid = true;
    try {
      await axios.get(`${api_base_url}/users/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
    } catch {
      tokenValid = false;
    }

    // If token invalid, refresh it
    if (!tokenValid) {
      logger.info("Token invalid generating new one");
      const decryptedRefreshToken = decrypt(teacherData.refresh_token);
      const newTokens = await refreshZoomToken(decryptedRefreshToken);
      if (!newTokens) throw new Error("Failed to refresh Zoom token");

      access_token = newTokens.access_token;

      // Save updated tokens in teacherData
      await TeacherModel.updateOne(
        { _id: teacherData._id },
        { access_token: encrypt(newTokens.access_token), 
          refresh_token: encrypt(newTokens.refresh_token) 
        }
      );
    }

     // Sanitize payload before sending
    const sanitizedDetails = {
      topic: meetingDetails.topic || "Lesson booking",
      type: meetingDetails.type || 2,
      start_time: meetingDetails.start_time || new Date().toISOString(),
      duration: meetingDetails.duration || 60,
      password: meetingDetails.password || Math.random().toString(36).slice(-8),
      timezone: "UTC",
      settings: meetingDetails.settings || {
       auto_recording: "cloud",
       host_video: true,
       participant_video: true,
       mute_upon_entry: true,
       join_before_host: true,
       waiting_room: false,
      },
    };

    // Create Zoom meeting
    const response = await axios.post(
      `${api_base_url}/users/me/meetings`,
      sanitizedDetails,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("response?.data", response?.data);

    return {
      join_url: response.data.join_url,
      start_url: response.data.start_url,
      meeting_url: response.data.join_url,
      meeting_id: response.data.id,
      meetingTime: response.data.start_time,
      purpose: response.data.topic,
      duration: response.data.duration,
      password: response.data.password,
      status: response.data.status,
    };
  } catch (error) {
    logger.error("Zoom API Error:", JSON.stringify(error.response?.data || error.message));
    console.error("Zoom API Error:", JSON.stringify(error.response?.data || error.message));
    return { success: false, message: "Zoom meeting creation failed" };
  }
};

module.exports = { createZoomMeeting, refreshZoomToken };