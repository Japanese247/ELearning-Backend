const mongoose = require("mongoose");

const bulkLessonSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher id is required"],
    },
    UserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Student id is required"],
    },
    LessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: [true, "Lesson id is required"],
    },
    paypalpaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "paypalpayments",
    },
    StripepaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "stripepayments",
    },
    totalAmount: {
      type: Number,
      required: [true, "Amount is required"],
    },
    teacherEarning: {
      type: Number,
      required: [true, "Teacher Earning is required"],
    },
    adminCommission: {
      type: Number,
      required: [true, "Admin Commission is required"],
    },
    processingFee: {
      type: Number,
      required: [true, "Processing Fee is required"],
    },
    usdToJpyRate: {
      type: Number,
      default: 0,
    },
    totalLessons: {
      type: Number,
      required: [true, "Total lessons are required"],
    },
    lessonsRemaining: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: [
        "active",
        "cancelled",
        "completed",
        "partially_refunded",
        "refunded",
      ],
      default: "active",
    },

    refundAmount: {
      type: Number,
      default: 0,
    },
    adminAdjustments: {
      type: [
        {
          type: {
            type: String,
            enum: ["credit_add", "credit_deduct", "manual_refund", "cancel"],
          },
          lessonsChanged: Number,
          amountChanged: Number,
          reason: String,
          adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          createdAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    bookings: {
      type: [
        {
          id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Bookings",
            required: true,
          },
          cancelled: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: [],
    },
    isFromWallet: {
      type: Boolean,
      default: false,
    },
    walletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },
  },
  { timestamps: true },
);

const bulkLessons = mongoose.model("bulkLessons", bulkLessonSchema);
module.exports = bulkLessons;
