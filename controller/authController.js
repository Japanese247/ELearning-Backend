const User = require("../model/user");
const Teacher = require("../model/teacher");
const Message = require("../model/message");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { errorResponse, successResponse, validationErrorResponse } = require("../utils/ErrorHandling");
const catchAsync = require("../utils/catchAsync");
const Loggers = require("../utils/Logger");
const sendEmail = require("../utils/EmailMailler");
const Welcome = require("../EmailTemplate/Welcome");
const TeacherWelcome = require("../EmailTemplate/TeacherWelcome");
const { uploadFileToSpaces, deleteFileFromSpaces } = require("../utils/FileUploader");
const mongoose = require('mongoose');
const StripePayment = require("../model/StripePayment");
const verifyTurnstile = require("../utils/verifyTurnstile");

const signEmail = async (id) => {
  const token = jwt.sign({ id }, process.env.JWT_SECRET_KEY, {
    expiresIn: "24h",
  });
  return token;
};

exports.studentSignup = catchAsync(async (req, res) => {
  try {
    const { name, email, password, role, time_zone } = req.body;
    Loggers.info(`[STUDENT_SIGNUP][ENTRY] name="${name || "N/A"}"`);
    if (!email || !password || !role || !name || !time_zone) {
      return errorResponse(res, "All fields are required", 401, "false");
    }

    const { cf_turnstile_token } = req.body;
    if (!cf_turnstile_token) {
      return errorResponse(res, "Captcha verification failed", 403);
    }
    const result = await verifyTurnstile(cf_turnstile_token, req.ip);

    if (!result.success) {
      Loggers.warn("[TURNSTILE_FAILED]", result);
      return errorResponse(res, "Captcha verification failed. Please refresh the page and try again.", 403);
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return errorResponse(
        res,
        "This email is already registered.",
        200,
        false
      );
    }

    // console.log("req.ip:", req.ip);
    // console.log("x-forwarded-for:", req.headers["x-forwarded-for"]);
    // const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;

    Loggers.info("[SIGNUP_ATTEMPT]", {
      ip: req.ip || "N/A",
      email,
      userAgent: req.headers["user-agent"],
      turnstile: result.success
    });

    const hashedPassword = await bcrypt.hash(password, 12);
    const userRecord = new User({
      name,
      email,
      password: hashedPassword,
      role,
      time_zone,
    });
    Loggers.info(`[STUDENT_SIGNUP][PRE_SAVE] name="${userRecord.name || "N/A"}"`);
    const userResult = await userRecord.save();
    if (!userResult) {
      return errorResponse(res, "Failed to create user.", 500);
    }
    Loggers.info(`[STUDENT_SIGNUP][POST_SAVE] name="${userResult?.name || "N/A"}"`);
    // console.log("userResult", userResult)
    const token = await signEmail(userResult._id);
    // console.log("token", token)
    const link = `https://akitainakaschoolonline.com/verify/${token}`;

    const registrationSubject = "Welcome to Japanese for Me!🎉 Your account has been created.";
    const emailHtml = Welcome(name, link);
    // console.log("signup emailHtml", emailHtml);



    // console.log("About to send email");
    const record = await sendEmail({
      email: email,
      subject: registrationSubject,
      emailHtml: emailHtml,
    });
    // console.log("Email record:", record);
    console.log("Sending signup email to", email);

    return successResponse(res, "User created successfully!", 201, {
      user: userResult,
    });

  } catch (error) {
    console.log("error", error);
    Loggers.error(error);
    if (error.code === 11000 && error.keyPattern?.email) {
      return errorResponse(
        res,
        "This email is already registered. Please log in or use a different email.",
        400
      );
    }
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((el) => el.message);
      console.log("errors", errors);
      return validationErrorResponse(res, errors.join(", "), 400, "error");
    }
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.teacherSignup = catchAsync(async (req, res) => {
  try {
    const { name, email, password, role, time_zone } = req.body;

    console.log("Incoming teacher signup request:", { name, email, role, time_zone });

    if (!email || !password || !role || !name || !time_zone) {
      console.warn("Missing required fields.");
      return errorResponse(res, "All fields are required", 401, "false");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    console.log("Password hashed successfully");

    const userRecord = new User({
      name,
      email,
      password: hashedPassword,
      role,
      time_zone,
    });

    const userResult = await userRecord.save();
    console.log("User saved in DB:", userResult?._id);

    if (!userResult) {
      return errorResponse(res, "Failed to create user.", 500);
    }

    const teacherRecord = new Teacher({
      userId: userResult._id,
    });

    const teacherResult = await teacherRecord.save();
    console.log("Teacher profile saved:", teacherResult?._id);

    if (!teacherResult) {
      await User.findByIdAndDelete(userResult._id);
      return errorResponse(res, "Failed to create teacher profile.", 500);
    }

    const registrationSubject = "Welcome to E-learning! 🎉 Your account has been created.";
    const emailHtml = TeacherWelcome(name);

    console.log("Preparing to send email to:", email);
    await sendEmail({
      email: email,
      subject: registrationSubject,
      emailHtml: emailHtml,
    });
    console.log("Email sent successfully to:", email);

    return successResponse(res, "Teacher created successfully!", 201, {
      user: userResult,
      carrier: teacherResult,
    });

  } catch (error) {
    console.error("Signup error occurred:", error);
    Loggers.error(error);

    if (error.code === 11000 && error.keyPattern?.email) {
      return errorResponse(
        res,
        "This email is already registered. Please log in or use a different email.",
        400
      );
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((el) => el.message);
      console.warn("Validation errors:", errors);
      return validationErrorResponse(res, errors.join(", "), 400, "error");
    }

    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.verifyEmail = catchAsync(async (req, res) => {
  try {
    const { token } = req.body;
    const { id } = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (!id) {
      return errorResponse(res, "Invalid or expired token", 400);
    }
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, "User not found", 404);
    }
    if (user.email_verify) {
      return successResponse(res, "Email is already verified.", 200);
    }
    user.email_verify = true;
    await user.save();
    return successResponse(res, "Email verified successfully!", 200);
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.login = catchAsync(async (req, res) => {
  // Code to sync indexes, just replace Ranks with your model name
  // (async () => {
  //   try {
  //     // iterate through all mongoose models
  //     for (const modelName of mongoose.modelNames()) {
  //       const model = mongoose.model(modelName);
  //       await model.syncIndexes();
  //       console.log(`Indexes synced for: ${modelName}`);
  //     }

  //     res.status(200).json({
  //       status: true,
  //       message: "Indexes synced for all models"
  //     });
  //   } catch (err) {
  //     console.error("Error syncing indexes:", err);
  //     res.status(500).json({ status: false, message: "Index sync failed" });
  //   }
  // })();

  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(401).json({
        status: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return errorResponse(res, "Invalid email", 401);
    }
    if (user?.block) {
      return errorResponse(res, "Your account is blocked", 401);
    }
    // if (password != user.password) {
    //   return errorResponse(res, "Invalid password", 401);
    // }
    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return errorResponse(res, "Invalid password", 400);
    }

    if (user?.role === "teacher") {
      const teacher = await Teacher.findOne({ userId: user._id });
      if (!teacher) {
        return errorResponse(res, "Teacher not found", 401);
      }
      if (teacher?.admin_approved === false) {
        return errorResponse(res, "Account not approved", 401);
      }
      if (teacher?.admin_approved === null) {
        return errorResponse(res, "Awaiting admin approval", 401);
      }
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, time_zone: user.time_zone, email: user.email },
      process.env.JWT_SECRET_KEY,
      { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
    );

    return res.status(200).json({
      status: true,
      message: "Login successful",
      token,
      role: user?.role,
    });
  } catch (error) {
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.GetUser = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      Loggers.error("Invalid User");
      return errorResponse(res, "Invalid User", 401);
    }

    const user = await User.findById(userId).select(
      "email name role time_zone profile_photo email_verify"
    );
    if (!user) {
      Loggers.error("Invalid User");
      return errorResponse(res, "Invalid User", 401);
    }

    let unreadCount = 0;

    if (user.role === "student") {
      unreadCount = await Message.countDocuments({
        student: userId,
        is_read: false,
        sent_by: "teacher"
      });
    }
    else if (user.role === "teacher") {
      unreadCount = await Message.countDocuments({
        teacher: userId,
        is_read: false,
        sent_by: "student"
      });
    }
    // console.log("unreadCount", unreadCount);
    const userObj = user.toObject();
    userObj.unreadCount = unreadCount || 0;

    return successResponse(res, "User Get successfully!", 201, {
      user: userObj,
    });
  } catch (error) {
    console.error(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.updateProfile = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return errorResponse(res, "Invalid User", 401);
    }

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, "User not found", 404);
    }

    const updates = req.body;
    if (updates.password) {
      return errorResponse(res, "Password cannot be updated", 401);
    }

    // Checking if the changed email already exists
    if (user.email !== updates?.email) {
      const exists = await User.exists({ email: updates?.email });
      if (exists) {
        return errorResponse(res, "A User with the same email already exists", 404);
      }
    }

    let timeChanged = false;
    // console.log("updates.timezone", updates.time_zone);
    // console.log("user.timezone", user.time_zone);
    if (updates.time_zone && updates.time_zone !== user.time_zone) {
      timeChanged = true;
    }
    // console.log("timeChanged", timeChanged);

    let photo = null;
    if (req.file) {
      if (user.profile_photo) {
        const isDeleted = await deleteFileFromSpaces(user.profile_photo);
        if (!isDeleted) {
          return res.status(500).json({
            status: false,
            message: "Unable to delete old profile photo",
          });
        }
      }
      const fileKey = await uploadFileToSpaces(req.file);
      photo = fileKey;
    }

    if (photo) {
      updates.profile_photo = photo;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse(res, "No fields to update", 400);
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
    });

    return successResponse(res, "Profile updated successfully!", 200, {
      user: updatedUser,
      time: timeChanged,
    });
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.resetPassword = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const { existingPassword, newPassword } = req.body;

    if (!existingPassword || !newPassword) {
      return errorResponse(
        res,
        "Existing password and new password are required",
        400
      );
    }

    const user = await User.findById(userId).select("+password");

    if (!user) {
      return errorResponse(res, "User not found", 404);
    }

    const isPasswordValid = await bcrypt.compare(existingPassword, user.password);
    if (!isPasswordValid) {
      return errorResponse(res, "Existing password is incorrect", 400);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    user.password = hashedPassword;
    await user.save();

    return successResponse(res, "Password updated successfully!", 200);
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});

exports.ResendVerificationLink = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      Loggers.error("Invalid User");
      return errorResponse(res, "Invalid User", 401);
    }
    const userResult = await User.findById({ _id: userId });
    const token = await signEmail(userResult._id);
    const link = `https://akitainakaschoolonline.com/verify/${token}`;

    // Send email logic for student
    const registrationSubject =
      "Welcome to Japanese for Me!🎉 Your account has been created.";
    const emailHtml = Welcome(userResult?.name, link);
    await sendEmail({
      email: userResult?.email,
      subject: registrationSubject,
      emailHtml: emailHtml,
    });
    return successResponse(res, "Verification link sent successfully!", 200);
  } catch (error) {
    console.log(error);
    return errorResponse(res, error.message || "Internal Server Error", 500);
  }
});