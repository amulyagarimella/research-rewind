import { transporter } from "../../../lib/nodemailer";
import { generateUnsubscribeToken, feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, email } = body
        // console.log("DEBUG - snapshot: ", snapshot);
        const unsubscribeToken = generateUnsubscribeToken(email);
        const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${email}&token=${unsubscribeToken}`;

        const emailSubject = "Research Rewind - Confirmation 🔬";

        const editPrefs = "<br><br>" + "Edit your preferences anytime by " + generateHTMLLink(getBaseUrl(), "re-signing up") + " with the same email address." + "<br>"

        const emailBody = "Hi " + name + ", <br><br>Thanks for signing up for Research Rewind! You'll start receiving papers daily at 6am ET." + editPrefs + generateHTMLLink(feedbackLink, "Feedback?") + "<br>" + generateHTMLLink(unsubscribeLink, "Unsubscribe");
        
        await transporter.sendMail({
            from: `Research Rewind <${process.env.EMAIL_ADDRESS}>`,
            to: email,
            subject: emailSubject,
            html: emailBody,
        });

        return new Response(JSON.stringify({ success: true }), { status: 201});
    } catch (error) {
        console.error('Error sending confirmation email:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500});
    }
}
