const moment = require("moment");
module.exports = (userName, teacherName, startDateTime, link, price, endUTC) => {
    return `
<div id="email" style="background: #fdf6f7;padding: 20px 0;">
  <table role="presentation" border="0" cellspacing="0" width="100%" style="font-family: arial;max-width:450px; margin: auto;background-color: #fff;">        
    <tr>
      <td style="padding: .5rem  1rem;text-align: center;"> 
        <a href="https://www.japaneseforme.com/" style="text-decoration: none;">
          <img style="logo.png" src="https://student-teacher-platform.sgp1.digitaloceanspaces.com/logo.png" alt="Japanese For Me">
        </a>
      </td> 
    </tr>

    <tr>
      <td style=" padding: 1.5rem 1rem 2rem;"> 
        <img src="https://student-teacher-platform.sgp1.digitaloceanspaces.com/booked.png" alt="banner" style="max-width:100%;margin: auto;display: block;" />
      </td>
    </tr>

    <tr>
      <td style="padding: .1rem 1rem 1rem ;border-bottom: 1px solid rgba(0,0,0,.1)">
        <p style="font-size: 1.5rem; font-weight: bold; line-height: 1.9rem; text-align: center;color: #CC2828;margin: 0 0 .6rem;">${teacherName} created a special slot just for you! ✨</p> 
        <p style="font-size: 1.1rem; font-weight: bold; line-height: 1.6rem; text-align: center;color: #333333;margin: 0.8rem 0 .7rem;">Hi ${userName},</p>

        <p style="font-size: 1rem; font-weight: 400; line-height: 1.5rem; text-align: center;color: #333333;margin: 0 0 .5rem;">
          You've requested a custom session and ${teacherName} has created a special slot for you with the details below. Please complete your payment within <strong>24 hours</strong> to confirm the booking.
        </p>

        <div style="max-width: 300px; margin: 0 auto 1.2rem;padding-bottom: 15px;background-image: url(https://student-teacher-platform.sgp1.digitaloceanspaces.com/pc-bg.png); background-repeat: no-repeat;background-position: bottom center; background-size: contain;">
          <div style="border:6px solid #CC2828;border-radius: 20px;">
            <table cellspacing="0" cellpadding="0" style="width: 100%;margin: 0">
              <tr>
                <td width="30%" style="font-size: 1rem; font-weight: 600; line-height: 18px;text-align: left;color: #333333;padding: 1rem 1.3rem;border-bottom: 1px solid #CC2828;">Date:</td> 
                <td width="70%" style="font-size: 1rem; font-weight: 400; line-height: 1.3rem;text-align: left;color: #CC2828;padding: 1rem 1.3rem;border-bottom: 1px solid #CC2828;">
                  <img src="https://student-teacher-platform.sgp1.digitaloceanspaces.com/date.png" style="max-width:100%;vertical-align: text-bottom;"> ${moment(startDateTime).format("DD MMM. YYYY")}
                </td> 
              </tr>
              <tr>
                <td width="30%" style="font-size: 1rem; font-weight: 600; line-height: 18px;text-align: left;color: #333333;padding: .6rem 1.3rem;border-bottom: 1px solid #CC2828;">Time:</td> 
                <td width="70%" style="font-size: 1rem; font-weight: 400; line-height: 1.3rem;text-align: left;color: #CC2828;padding: .6rem 1.3rem;border-bottom: 1px solid #CC2828;">
                  <img src="https://student-teacher-platform.sgp1.digitaloceanspaces.com/time.png" style="max-width:100%;vertical-align: text-bottom;"> ${moment(startDateTime).format("hh:mm A")} UTC
                </td> 
              </tr>
              <tr>
                <td width="30%"style="font-size: 1rem; font-weight: 600; line-height: 18px;text-align: left;color: #333333;padding: .6rem 1.3rem;border-bottom: 1px solid #CC2828;">End Time:</td> 
                <td width="70%" style="font-size: 1rem; font-weight: 400; line-height: 1.3rem;text-align: left;color: #CC2828;padding: .6rem 1.3rem;border-bottom: 1px solid #CC2828;">
                    ${moment(endUTC).format("hh:mm A")} UTC
                </td> 
              </tr>
              <tr>
                <td width="30%" style="font-size: 1rem; font-weight: 600; line-height: 18px;text-align: left;color: #333333;padding: .6rem 1.3rem;">Price:</td> 
                <td width="70%" style="font-size: 1rem; font-weight: 400; line-height: 1.3rem;text-align: left;color: #CC2828;padding: .6rem 1.3rem;">
                  USD ${price}
                </td> 
              </tr>
            </table>
          </div>
        </div>

        <p style="margin: 0 0 1.3rem;text-align: center;">
          <a href="${link}" style="background:#CC2828;color:#fff;border-radius: 7px;font-size: 1.1rem;text-decoration: none;display: inline-block;padding: .8rem 1.5rem;">
            Complete Payment
          </a>
        </p>

        <p style="font-size: 1rem; font-weight: 400; line-height: 22px; text-align: center;color: #333333;margin: 0 0 1.5rem;">
          If payment is not completed in time, the slot will be released. If you have not requested a special slot, please ignore this email.
        </p>  
      </td>
    </tr>

    <tr>
      <td style="padding: .1rem 0rem 1rem ;">
        <div style="padding: 1.3rem  0rem;background: #EFD1D1;">
          <p style="font-size: 12px; font-weight: 400; line-height: 18px;  text-align: center;color: #CC2828;margin: 0 auto; max-width: 260px;">© 2025 Japanese for Me. All Rights Reserved.</p>
        </div>
      </td>
    </tr>
  </table>
</div>
  `;
};