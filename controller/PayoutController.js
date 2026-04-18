const Bank = require("../model/Bank");
const Bookings = require("../model/booking");
const Bonus = require("../model/Bonus");
const Payout = require("../model/Payout");
const Currency = require("../model/Currency");
const catchAsync = require("../utils/catchAsync");
const Loggers = require("../utils/Logger");

exports.PayoutAdd = catchAsync(async (req, res) => {
  const userId = req?.user?.id;
  const { amount } = req.body;

  if (!userId) {
    return res.status(400).json({
      status: false,
      message: "User ID is missing.",
    });
  }
  
  if (!amount) {
    return res.status(400).json({
      status: false,
      message: "Amount is required.",
    });
  }
  
  const Banks = await Bank.findOne({ userId: userId });
  if(!Banks){
    return res.status(400).json({
      status: false,
      message: "Please add your bank account first.",
    });
  }
  

  const time = Date.now();
  const rateDoc = await Currency.findOne({ currency: "JPY" });
  const usdToJpyRate = Number(rateDoc?.rate || 0) || 0;
  if (!usdToJpyRate) {
    return res.status(500).json({
      status: false,
      message: "JPY conversion rate is not available. Please try again later.",
    });
  }
  const computedAmountInJpy = Math.round((Number(amount) || 0) * usdToJpyRate);

  const bookings = await Bookings.updateMany(
    {
      teacherId: userId,
      lessonCompletedStudent: true,
      lessonCompletedTeacher: true,
      payoutCreationDate: null,
    },
    { $set: { payoutCreationDate: time } },
    {
      new: true, // Not needed in updateMany, only works in findOneAndUpdate
      runValidators: true,
    }
  );

  const bonus = await Bonus.updateMany(
    {
      teacherId: userId,
      payoutCreationDate: null,
    },
    { $set: { payoutCreationDate: time } },
    {
      new: true, // Not needed in updateMany, only works in findOneAndUpdate
      runValidators: true,
    }
  );
  try {
    const record = new Payout({
      BankId: Banks._id,
      amount,
      amountInJpy: computedAmountInJpy,
      userId,
      createdAt: time,
    });

    const result = await record.save();

    return res.status(201).json({
      status: true,
      message: "Payout details have been successfully added!",
      data: result,
    });
  } catch (error) {
    console.log("error", error);
    Loggers.error("Error in adding payout", error);
    return res.status(500).json({
      status: false,
      message: error,
    });
  }
});

exports.payoutList = catchAsync(async (req, res) => {
  const userId = req?.user?.id;
  if (!userId) {
    return res.status(400).json({
      status: false,
      message: "User ID is missing.",
    });
  }
  const { status } = req.query;
  try {
    const filter = {
      userId
    };
    if(status && status!=""){
      filter.Status=status;
    }
    const result = await Payout.find( filter )
      .sort({ createdAt: -1 })
      .populate("BankId");
    if (result.length === 0) {
      return res.status(404).json({
        status: false,
        message: "No bank records found.",
      });
    }
    return res.status(200).json({
      status: true,
      message: "Bank records retrieved successfully.",
      data: result,
    });
  } catch (error) {
    Loggers.error(error);
    return res.status(500).json({
      status: false,
      message: "Failed to retrieve bank records.",
      error: error.message,
    });
  }
});
