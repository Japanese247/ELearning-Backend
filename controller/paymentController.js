const stripe = require('../utils/stripe');
const catchAsync = require("../utils/catchAsync");
const axios = require("axios");
const qs = require('qs');
const Payment = require("../model/PaypalPayment");
const StripePayment = require("../model/StripePayment");
const Bookings = require("../model/booking");
const Lesson = require("../model/lesson");
const BulkLessons = require("../model/bulkLesson");
const { DateTime } = require("luxon");
const BookingSuccess = require("../EmailTemplate/BookingSuccess");
const BulkEmail = require("../EmailTemplate/BulkLesson");
const TeacherBulkEmail = require("../EmailTemplate/TeacherBulkLesson");
const TeacherBooking = require("../EmailTemplate/TeacherBooking");
const sendEmail = require("../utils/EmailMailler");
const User = require("../model/user");
const Wallet = require("../model/wallet");
const WalletTransaction = require("../model/walletTransaction");
const SpecialSlot = require("../model/SpecialSlot");
const mongoose = require("mongoose");
const Bonus = require('../model/Bonus');
const logger = require("../utils/Logger");
const Currencies = require("../model/Currency");

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const paypalApiUrl = process.env.PAYPAL_API;

const generateAccessToken = async () => {
  try {
    const auth = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString('base64');
    const response = await axios.post(
      `${paypalApiUrl}/v1/oauth2/token`,
      qs.stringify({
        grant_type: 'client_credentials',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error("PayPal Token Error:", error.response?.data || error.message);
    logger.error(`PayPal Token Error: ${JSON.stringify(error.response?.data || error.message || 'Unknown error')}`);
  }
};

exports.createOrder = catchAsync(async (req, res) => {
  try {
    const { amount, currency, } = req.body
    const accessToken = await generateAccessToken();
    const paypalApiUrl = process.env.PAYPAL_API;
    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: amount,
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            payment_method_selected: "PAYPAL",
            brand_name: "DekayHub - Volatility Grid",
            shipping_preference: "NO_SHIPPING",
            locale: "en-US",
            user_action: "PAY_NOW",
          },
        },
      },
    };

    const response = await axios.post(
      `${paypalApiUrl}/v2/checkout/orders`,
      orderData,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    logger.info("Paypal order create route ran successfully");
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error in createOrder controller:', error);
    logger.error(`Error in createOrder controller:, ${JSON.stringify(error || 'Unknown error')}`);
    res.status(500).json({ error: error || 'Failed to create PayPal order' });
  }
}
);

// Bulk booking iss function ke through hoti hai
async function handleBulkBooking(data) {
  try {
    // console.log("Bulk booking called with data:", data);
    const { orderID, teacherId, LessonId, totalAmount, adminCommission, email, processingFee, multipleLessons, UserId, req, res } = data;
    // Saving the payment details
    const accessToken = await generateAccessToken();
    const response = await axios.post(
      `${paypalApiUrl}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    const captureData = response.data;
    const newPayment = new Payment({
      orderID: captureData.id,
      intent: captureData.intent,
      status: captureData.status,
      purchase_units: captureData.purchase_units,
      payer: captureData.payer,
      payment_source: captureData.payment_source,
      capturedAt: new Date(),
      LessonId: LessonId || undefined,
      UserId: UserId || undefined,
      amount: captureData.purchase_units[0].payments.captures[0].amount.value,
      currency: captureData.purchase_units[0].payments.captures[0].amount.currency_code,
    });
    const savedPayment = await newPayment.save();
    logger.info(`PayPal payment saved for bulk lesson, paymentId: ${JSON.stringify(savedPayment || "")}`);

    // Bulk lesson record creation
    const bulkLesson = new BulkLessons({
      teacherId,
      UserId,
      LessonId,
      paypalpaymentId: savedPayment?._id,
      StripepaymentId: null,
      totalAmount,
      teacherEarning: (totalAmount - processingFee) * 0.90 || 0,
      adminCommission,
      processingFee,
      totalLessons: multipleLessons,
      lessonsRemaining: multipleLessons,
    });
    const savedBulkLesson = await bulkLesson.save();
    logger.info(`Bulk lesson record created: ${JSON.stringify(savedBulkLesson || "")}`);

    const user = await User.findById({ _id: UserId });
    const teacher = await User.findById({ _id: teacherId });
    const lesson = await Lesson.findById(LessonId);
    const Username = user?.name;

    // Sending bulk email to student
    const emailHtml = BulkEmail(Username , multipleLessons, teacher?.name, lesson?.title);
    const subject = "Bulk Lesson Purchase is Successful! 🎉";
    logger.info(`Paypal sending bulk email to student at  ${email}`);
    await sendEmail({
      email: email,
      subject: subject,
      emailHtml: emailHtml,
    });

    // Sending bulk email to teacher
    const TeacheremailHtml = TeacherBulkEmail(Username , multipleLessons, teacher?.name, lesson?.title);
    const TeacherSubject = "New Bulk Lesson Purchase Received 🎉";
    logger.info(`Paypal sending bulk email to teacher at  ${teacher?.email}`);
    await sendEmail({
      email: teacher?.email,
      subject: TeacherSubject,
      emailHtml: TeacheremailHtml,
    });
    res.status(200).json(savedPayment);
  } catch (err) {
    console.error("Bulk booking handler error:", err);
    return data.res.status(500).json({
      status: false,
      error: err.message || "Bulk handler failed"
    });
  }
}

exports.PaymentcaptureOrder = catchAsync(async (req, res) => {
  try {
    const UserId = req.user.id;
    const { orderID, teacherId, startDateTime, endDateTime, LessonId, timezone, totalAmount, adminCommission, email,
      isSpecialSlot, processingFee, isBulk, multipleLessons } = req.body;
    
    // Bulk booking handling
    if (isBulk) {
      return handleBulkBooking({
        ...req.body,        
        UserId,             
        req,                
        res                 
      });
    }

    let startUTCs, endUTCs;
    if (isSpecialSlot) {
      logger.info(`Special slot PayPal booking request body: ${JSON.stringify(req.body || "")}`);
      logger.info(`Special slot PayPal booking: userId:", UserId, email: ${email}, teacherId: ${teacherId}`);
      startUTCs =  new Date(startDateTime);
      endUTCs =  new Date(endDateTime);
    }
    else {
      startUTCs = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC().toJSDate();
      endUTCs = DateTime.fromISO(endDateTime, { zone: timezone }).toUTC().toJSDate();
    }

     // ✅ Get current UTC time
    const nowUTC = new Date();

    // ✅ Check if slot is in the past or less than 10 minutes from now
    const timeDiffInMs = startUTCs - nowUTC;
    const timeDiffInMinutes = timeDiffInMs / (1000 * 60);
    if (timeDiffInMinutes < 10) {
      return res.status(400).json({
        status: false,
        error: "Cannot create a booking which starts in less than 10 minutes from now or is in the past"
      });
    }

    // Check for booking conflict for the same teacher
    const existingBooking = await Bookings.findOne({
      teacherId: new mongoose.Types.ObjectId(teacherId),
      cancelled: false, // Only consider active bookings
      startDateTime: { $lt: endUTCs },
      endDateTime: { $gt: startUTCs },
    });
    if (existingBooking) {
      return res.status(400).json({
        status: false,
        error: "Booking already exists at the given slot for this teacher.",
      });
    }

    const accessToken = await generateAccessToken();
    const response = await axios.post(
      `${paypalApiUrl}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const captureData = response.data;
    const newPayment = new Payment({
      orderID: captureData.id,
      intent: captureData.intent,
      status: captureData.status,
      purchase_units: captureData.purchase_units,
      payer: captureData.payer,
      payment_source: captureData.payment_source,
      capturedAt: new Date(),
      LessonId: LessonId || undefined,
      UserId: UserId || undefined,
      amount: captureData.purchase_units[0].payments.captures[0].amount.value, // "100.00"
      currency: captureData.purchase_units[0].payments.captures[0].amount.currency_code, // "USD"
    });
    const savedPayment = await newPayment.save();
     logger.info(`PayPal payment saved, paymentId: ${JSON.stringify(savedPayment || "")}`);
    let startUTC, endUTC;
    if (isSpecialSlot) {
      startUTC = new Date(startDateTime);
      endUTC = new Date(endDateTime);
    } else {
      startUTC = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC().toJSDate();
      endUTC = DateTime.fromISO(endDateTime, { zone: timezone }).toUTC().toJSDate();
    }
    const rate = await Currencies.findOne({ currency: "JPY" });
    const teacherEarning = (totalAmount - processingFee) * 0.90; // 90% to teacher, 10% to admin as discussed with client
    const Bookingsave = new Bookings({
      teacherId,
      totalAmount,
      adminCommission,
      teacherEarning,
      UserId: UserId,
      LessonId,
      paypalpaymentId: savedPayment?._id,
      startDateTime: startUTC,
      endDateTime: endUTC,
      processingFee,
      usdToJpyRate: rate?.rate || 0,      
    });
    const record = await Bookingsave.save();

    // Updating Special Slot
    if (isSpecialSlot) {
      const studentId = new mongoose.Types.ObjectId(UserId);
      const lessonId = new mongoose.Types.ObjectId(LessonId);
      const updatedSlot = await SpecialSlot.findOneAndUpdate(
        {
          student: studentId,
          lesson: lessonId,
          startDateTime: startUTC,
        },
        { paymentStatus: "paid" },
        { new: true, runValidators: true }
      );
      if (updatedSlot) {
        await Bookings.findByIdAndUpdate(record._id, {
          specialSlotId: updatedSlot._id,
        });
      }
    }


    const user = await User.findById({ _id: req.user.id });
    const teacher = await User.findById({ _id: teacherId });
    logger.info("Paypal Everything done now about to send email");
    logger.info(`Teacher details: ${JSON.stringify(teacher || "")}`);
    const registrationSubject = "Booking Confirmed 🎉";
    const Username = user?.name;

    const utcDateTime = DateTime.fromJSDate(new Date(startUTC), { zone: "utc" });
    const nowTime = DateTime.utc();
    const startUTCDateTime = DateTime.fromJSDate(new Date(record.startDateTime)).toUTC();
    const minutesUntilStart = startUTCDateTime.diff(nowTime, "minutes").minutes;
    console.log("minutesUntil", minutesUntilStart);
    const userTimeISO = user?.time_zone
        ? utcDateTime.setZone(user.time_zone).toISO()
        : utcDateTime.toISO();

      const teacherTimeISO = teacher?.time_zone
        ? utcDateTime.setZone(teacher.time_zone).toISO()
        : utcDateTime.toISO();
      
    if (minutesUntilStart > 30) {
      const emailHtml = BookingSuccess(userTimeISO , Username, teacher?.name);
      logger.info(`Paypal sending email to student at  ${email}`);
      await sendEmail({
        email: email,
        subject: registrationSubject,
        emailHtml: emailHtml,
      });
    } else {
      logger.info(
        `Skipping booking-confirmation email to student for booking ${record?._id} because lesson starts in ${Math.floor(minutesUntilStart)} minutes`
      );
    }

    const TeacherSubject = "New Booking 🎉";
    const TeacheremailHtml = TeacherBooking(teacherTimeISO, Username, teacher?.name);
    logger.info(`Paypal sending email to teacher at: ${teacher?.email}`);
    await sendEmail({
      email: teacher.email,
      subject: TeacherSubject,
      emailHtml: TeacheremailHtml,
    });
    logger.info("Paypal order created route ran successfully");
    res.status(200).json(savedPayment);
  } catch (error) {
    console.error(" Error capturing PayPal order:", error?.response?.data || error.message);
    logger.error(`Error capturing PayPal order: ${JSON.stringify(error?.response?.data || error.message || 'Unknown error')}`);
    res.status(500).json({ error: error || "Failed to capture and save PayPal order" });
  }
});

exports.PaymentWalletCaptureOrder = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderID } = req.body;

    const accessToken = await generateAccessToken();

    const response = await axios.post(
      `${paypalApiUrl}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const captureData = response.data;

    const capture = captureData.purchase_units[0].payments.captures[0];

    const rechargeAmount = Number(capture.amount.value);

    // 1️⃣ Save PayPal Payment
    const newPayment = await Payment.create({
      orderID: captureData.id,
      intent: captureData.intent,
      status: captureData.status,
      purchase_units: captureData.purchase_units,
      payer: captureData.payer,
      payment_source: captureData.payment_source,
      capturedAt: new Date(),
      UserId: userId,
      amount: rechargeAmount,
      currency: capture.amount.currency_code,
      isWallet: true,
    });

    // 2️⃣ Atomic Wallet Update (safe & professional way)
    const wallet = await Wallet.findOneAndUpdate(
      { userId },
      { $inc: { balance: rechargeAmount } },
      { new: true, upsert: true }
    );

    // 3️⃣ Create Wallet Transaction Entry
    await WalletTransaction.create({
      userId,
      type: "credit",
      amount: rechargeAmount,
      reason: "Wallet Recharge (PayPal)",
      paypalPaymentId: newPayment._id,
      balance: wallet.balance, // running balance
    });

    console.log(`Wallet credited via PayPal | User: ${userId} | Amount: ${rechargeAmount} | Balance: ${wallet.balance}`);

    return res.status(200).json({
      success: true,
      payment: newPayment,
      walletBalance: wallet.balance,
    });

  } catch (error) {
    console.error("Error capturing PayPal Wallet order:", error?.response?.data || error.message);
    logger.error(`Error capturing PayPal order: ${JSON.stringify(error?.response?.data || error.message || "Unknown error")}`);
    return res.status(500).json({
      error: "Failed to capture and process wallet recharge",
    });
  }
});

exports.PaymentcancelOrder = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderID, LessonId } = req.body;

    if (!orderID) {
      return res.status(400).json({ error: "orderID is required" });
    }

    const accessToken = await generateAccessToken();
    try {
      const voidResponse = await axios.post(
        `${paypalApiUrl}/v2/checkout/orders/${orderID}/void`,
        {},
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
    } catch (paypalErr) {
      console.warn("Could not void PayPal order (maybe already captured?):", paypalErr.response?.data || paypalErr.message);
    }
    const existing = await Payment.findOne({ orderID });
    if (existing) {
      return res.status(200).json({ status: "CANCELLED", message: "Already recorded" });
    }

    const newPayment = new Payment({
      orderID,
      status: "CANCELLED",
      capturedAt: new Date(),
      LessonId: LessonId || undefined,
      UserId: userId || undefined,
    });

    const record = await newPayment.save();
    res.status(200).json({ status: "CANCELLED", message: "Order cancelled successfully" });
  } catch (error) {
    console.error("Error saving cancelled order:", error.message);
    logger.error(`Error saving cancelled order: ${JSON.stringify(error || 'Unknown error')}`);
    res.status(500).json({ error: error || "Failed to cancel order" });
  }
}
);

// For Tips  teacher given  by student 
exports.PaymentcaptureTipsOrder = catchAsync(async (req, res) => {
  try {
    const UserId = req.user.id;
    const { orderID, teacherId, LessonId, totalAmount, IsBonus, BookingId } = req.body;
    const accessToken = await generateAccessToken();
    const response = await axios.post(
      `${paypalApiUrl}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const captureData = response.data;
    const newPayment = new Payment({
      orderID: captureData.id,
      intent: captureData.intent,
      status: captureData.status,
      purchase_units: captureData.purchase_units,
      payer: captureData.payer,
      payment_source: captureData.payment_source,
      capturedAt: new Date(),
      LessonId: LessonId || undefined,
      UserId: UserId || undefined,
      amount: captureData.purchase_units[0].payments.captures[0].amount.value, // "100.00"
      currency: captureData.purchase_units[0].payments.captures[0].amount.currency_code, // "USD"
      IsBonus: IsBonus,
    });

    const savedPayment = await newPayment.save();
    const record = await Bonus.create({
      userId: UserId,
      teacherId,
      LessonId,
      bookingId: BookingId,
      amount: totalAmount,
      currency: "USD",
      paypalpaymentId: savedPayment?._id,
    });


    const BookingData = await Bookings.findOneAndUpdate(
      { _id: BookingId },
      {
        IsBonus: true,
        BonusId: record._id,
      },
      { new: true }
    );
    res.status(200).json(savedPayment);
  } catch (error) {
    console.error(" Error capturing PayPal order:", error?.response?.data || error.message);
    logger.error(`Error capturing PayPal order: ${JSON.stringify(error?.response?.data || error.message || 'Unknown error')}`);
    res.status(500).json({ error: "Failed to capture and save PayPal order" });
  }
});

exports.PaymentCreate = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;

    const { amount, LessonId, currency, teacherId, startDateTime, 
      endDateTime, timezone, adminCommission, email, isSpecial, 
      IsBonus, BookingId, processingFee, isBulk, multipleLessons
    } = req.body;

    let startUTC, endUTC;

    if(!isBulk){
      if (isSpecial) {
        startUTC = new Date(startDateTime);
        endUTC = new Date(endDateTime);
      } else {
        startUTC = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC().toJSDate();
        endUTC = DateTime.fromISO(endDateTime, { zone: timezone }).toUTC().toJSDate();
      }

      const nowUTC = new Date();
      const timeDiffInMinutes = (startUTC - nowUTC) / (1000 * 60);

      if (timeDiffInMinutes < 10) {
        return res.status(400).json({
          status: false,
          error: "Cannot select a slot that starts in less than 10 minutes or is in the past"
        });
      }

      const existingBooking = await Bookings.findOne({
        teacherId: new mongoose.Types.ObjectId(teacherId),
        cancelled: false,
        startDateTime: { $lt: endUTC },
        endDateTime: { $gt: startUTC },
      });

      if (existingBooking) {
        return res.status(400).json({
          status: false,
          error: "Booking already exists at the given slot for this teacher.",
        });
      }
    }

    const lastpayment = await StripePayment.findOne().sort({ srNo: -1 });
    const srNo = lastpayment ? lastpayment.srNo + 1 : 1;
    const amountInCents = Math.round(amount * 100);

    const rate = await Currencies.findOne({ currency: "JPY" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: "Lesson Booking Payment",
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.DOMAIN}/success`,
      cancel_url: `${process.env.DOMAIN}/cancel`,
      metadata: {
        userId,
        LessonId,
        teacherId,
        startDateTime,
        endDateTime,
        timezone,
        adminCommission,
        email,
        amount,
        currency,
        srNo: srNo.toString(),
        isSpecial,
        BookingId,
        IsBonus,
        processingFee,
        isBulk,
        multipleLessons,
        rate: rate?.rate || 0,
      }
    });

    res.json({ url: session.url });

  } catch (error) {
    console.error('Error creating checkout session:', error);
    logger.error(`Error creating checkout session: ${JSON.stringify(error || 'Unknown error')}`);
    res.status(500).json({ error: error || 'Internal Server Error' });
  }
});

exports.WalletPaymentCreate = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, currency, email } = req.body;

    const lastpayment = await StripePayment.findOne().sort({ srNo: -1 });
    const srNo = lastpayment ? lastpayment.srNo + 1 : 1;

    const amountInCents = Math.round(Number(amount) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"], // ✅ Apple Pay is auto-included under "card"
      customer_email: email,

      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: "Wallet Recharge",
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],

      metadata: {
        userId,
        amount,
        currency,
        isWallet: true,
        srNo: srNo.toString(),
      },

      success_url: `${process.env.DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN}/cancel`,
    });

    res.json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: "Unable to create checkout session" });
  }
});

async function handleBulkWalletBooking(data) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      teacherId,
      LessonId,
      totalAmount,
      adminCommission,
      email,
      processingFee,
      multipleLessons,
      UserId,
      res
    } = data;

    // 1️⃣ Check wallet balance
    const wallet = await Wallet.findOne({ userId: UserId }).session(session);

    if (!wallet || wallet.balance < totalAmount) {
      throw new Error("Insufficient wallet balance");
    }

    // 2️⃣ Deduct balance atomically
    wallet.balance -= totalAmount;
    await wallet.save({ session });

    // 3️⃣ Create bulk lesson record
    const bulkLesson = await BulkLessons.create([{
      teacherId,
      UserId,
      LessonId,
      paypalpaymentId: null,
      StripepaymentId: null,
      totalAmount,
      teacherEarning: (totalAmount - processingFee) * 0.90,
      adminCommission,
      processingFee,
      totalLessons: multipleLessons,
      lessonsRemaining: multipleLessons,
      isFromWallet: true,
    }], { session });

    // 4️⃣ Wallet transaction (debit)
    const walletTransaction = await WalletTransaction.create([{
      userId: UserId,
      type: "debit",
      amount: totalAmount,
      reason: "Bulk Lesson Purchase (Wallet)",
      bulkLessonId: bulkLesson[0]._id,
      balance: wallet.balance,
    }], { session });

    await BulkLessons.findByIdAndUpdate(
      bulkLesson[0]._id,
      {
        isFromWallet: true,
        walletTransactionId: walletTransaction[0]._id
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // 5️⃣ Send email (outside transaction)
    const user = await User.findById(UserId);
    const teacher = await User.findById(teacherId);
    const lesson = await Lesson.findById(LessonId);

    // Sending bulk email to student
    const emailHtml = BulkEmail(user?.name, multipleLessons, teacher?.name, lesson?.title);
    await sendEmail({
      email,
      subject: "Bulk Lesson Purchase is Successful! 🎉",
      emailHtml
    });

    // Sending bulk email to teacher
    const TeacheremailHtml = TeacherBulkEmail(Username , multipleLessons, teacher?.name, lesson?.title);
    const TeacherSubject = "New Bulk Lesson Purchase Received 🎉";
    logger.info(`Paypal sending bulk email to teacher at  ${teacher?.email}`);
    await sendEmail({
      email: teacher?.email,
      subject: TeacherSubject,
      emailHtml: TeacheremailHtml,
    });

    return res.status(200).json({ status: true });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return data.res.status(400).json({
      status: false,
      error: err.message
    });
  }
}

exports.WalletBookingPayment = catchAsync(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const UserId = req.user.id;

    const {
      teacherId,
      startDateTime,
      endDateTime,
      LessonId,
      timezone,
      totalAmount,
      adminCommission,
      email,
      isSpecial,
      processingFee,
      isBulk,
      multipleLessons
    } = req.body;

    // 🔥 BULK HANDLING
    if (isBulk) {
      await session.abortTransaction();
      session.endSession();
      return handleBulkWalletBooking({
        ...req.body,
        UserId,
        res
      });
    }

    // 🔹 TIME CONVERSION (EXACT COPY)
    let startUTC, endUTC;

    if (isSpecial) {
      startUTC = new Date(startDateTime);
      endUTC = new Date(endDateTime);
    } else {
      startUTC = DateTime.fromISO(startDateTime, { zone: timezone }).toUTC().toJSDate();
      endUTC = DateTime.fromISO(endDateTime, { zone: timezone }).toUTC().toJSDate();
    }

    // 🔹 10 MIN CHECK
    const nowUTC = new Date();
    const timeDiffInMinutes = (startUTC - nowUTC) / (1000 * 60);

    if (timeDiffInMinutes < 10) {
      throw new Error("Cannot create booking less than 10 minutes before start time");
    }

    // 🔹 SLOT CONFLICT CHECK
    const existingBooking = await Bookings.findOne({
      teacherId: new mongoose.Types.ObjectId(teacherId),
      cancelled: false,
      startDateTime: { $lt: endUTC },
      endDateTime: { $gt: startUTC },
    }).session(session);

    if (existingBooking) {
      throw new Error("Booking already exists at the given slot for this teacher.");
    }

    // 🔥 WALLET CHECK
    const wallet = await Wallet.findOne({ userId: UserId }).session(session);

    if (!wallet || wallet.balance < totalAmount) {
      throw new Error("Insufficient wallet balance");
    }

    // 🔥 DEDUCT WALLET
    wallet.balance -= totalAmount;
    await wallet.save({ session });

    // 🔥 CREATE BOOKING
    const teacherEarning = (totalAmount - processingFee) * 0.90;

    const rate = await Currencies.findOne({ currency: "JPY" });
    const booking = await Bookings.create([{
      teacherId,
      totalAmount,
      adminCommission,
      teacherEarning,
      UserId,
      LessonId,
      paypalpaymentId: null,
      StripepaymentId: null,
      startDateTime: startUTC,
      endDateTime: endUTC,
      processingFee,
      isFromWallet: true,
      usdToJpyRate: rate?.rate || 0,
    }], { session });

    // 🔥 SPECIAL SLOT UPDATE
    if (isSpecial) {
      const updatedSlot = await SpecialSlot.findOneAndUpdate(
        {
          student: UserId,
          lesson: LessonId,
          startDateTime: startUTC,
        },
        { paymentStatus: "paid" },
        { new: true, session }
      );

      if (updatedSlot) {
        await Bookings.findByIdAndUpdate(
          booking[0]._id,
          { specialSlotId: updatedSlot._id },
          { session }
        );
      }
    }

    // 🔥 WALLET TRANSACTION
    const walletTransaction = await WalletTransaction.create([{
      userId: UserId,
      type: "debit",
      amount: totalAmount,
      reason: "Lesson Booking (Wallet)",
      bookingId: booking[0]._id,
      balance: wallet.balance,
    }], { session });

    await Bookings.findByIdAndUpdate(
      booking[0]._id,
      { walletTransactionId: walletTransaction[0]._id },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // 📧 EMAILS (outside transaction)
    const user = await User.findById(UserId);
    const teacher = await User.findById(teacherId);

    const utcDateTime = DateTime.fromJSDate(new Date(startUTC), { zone: "utc" });

    const userTimeISO = user?.time_zone
      ? utcDateTime.setZone(user.time_zone).toISO()
      : utcDateTime.toISO();

    const teacherTimeISO = teacher?.time_zone
      ? utcDateTime.setZone(teacher.time_zone).toISO()
      : utcDateTime.toISO();

    const nowTime = DateTime.utc();
    const startUTCDateTime = DateTime.fromJSDate(new Date(startUTC)).toUTC();
    const minutesUntilStart = startUTCDateTime.diff(nowTime, "minutes").minutes;

    await sendEmail({
      email: teacher.email,
      subject: "New Booking 🎉",
      emailHtml: TeacherBooking(teacherTimeISO, user?.name, teacher?.name)
    }); 

    if (minutesUntilStart > 30) {
      await sendEmail({
        email,
        subject: "Booking Confirmed 🎉",
        emailHtml: BookingSuccess(userTimeISO, user?.name, teacher?.name)
      });
    } else {
      logger.info(
        `Skipping booking-confirmation email to student for wallet booking ${booking?.[0]?._id} because lesson starts in ${Math.floor(minutesUntilStart)} minutes`
      );
    }

    return res.status(200).json({ status: true });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      status: false,
      error: error.message
    });
  }
});
