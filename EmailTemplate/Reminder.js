module.exports = (userName, link, time, teacherName, lessonName, diffInMinutes) => {
    return `
   <div id="email" style="background: #d9d9d9;padding: 20px 0;">
    <table role="presentation" border="0" cellspacing="0" width="100%" style="font-family: arial;max-width:450px; margin: auto;background-color: #fff;">        
        <tr>
            <td style="padding: .5rem  1rem;text-align: center;"> 
                <a href="https://www.akitainakaschoolonline.com/" style="text-decoration: none;">
                  <img style="logo.png " src="https://student-teacher-platform.sgp1.digitaloceanspaces.com/logo.png" alt="Akita Inaka School Online">
                </a>
             </td> 
        </tr>
         <tr>
            <td style=" padding: 0rem 1rem .2rem;"> 
                <img src="https://student-teacher-platform.sgp1.digitaloceanspaces.com/reminder-banner.png" alt="" style="max-width:100%;margin: auto;display: block;" />
            </td>
        </tr>
        <tr>
            <td style="padding: .1rem 1rem 1rem ;border-bottom: 1px solid rgba(0,0,0,.1);max-width: 36px;">
                <p style="font-size: 1.5rem; font-weight: bold; line-height: 1.9rem; text-align: center;color: #55844D;margin: 0 0 .6rem;">Coming Up: Your ${lessonName} Lesson starts in ${time} ⏳</p> 
                <p style="font-size: 1.1rem; font-weight: bold; line-height: 1.6rem; text-align: center;color: #333333;margin: 0 0 .7rem;">Hi ${userName}</p>

                <p style="font-size: 1rem; font-weight: 400; line-height: 1.5rem; text-align: center;color: #333333;margin: 0 0 1.3rem;">You’re just ${time} away from your session with ${teacherName}. Get ready!</p>  
                <p style="margin: 0 0 .5rem;text-align: center;"><a href="${link}" style="background:#55844D;color:#fff;border-radius: 7px;font-size: 1.1rem;text-decoration: none;display: inline-block;padding: .8rem 1.5rem;">
                ${(typeof diffInMinutes === "number" && diffInMinutes <= 30) ? "Join Session" : "View Booking"}
                </a></p>  
                </td>
            </tr>
            <tr> 
              <td style="padding:0;">  
                <div style="padding: 1.3rem  1rem;background: #55844D;">
                    <p style="font-size: 12px; font-weight: 400; line-height: 18px;  text-align: center;color: #ffff;margin: 0 auto; max-width: 260px;">© 2025 Akita Inaka School Online. All Rights Reserved.</p>
                </div>
            </td>
        </tr> 
    </table>
</div>
      `;
};
