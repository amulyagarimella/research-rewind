import { mg } from "../../../lib/mailgun";
import { feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, email } = body
        // console.log("DEBUG - snapshot: ", snapshot);
        const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${email}`;

        const emailSubject = "Research Rewind - Confirmation";

        const editPrefs = "<br><br>" + "Edit your preferences anytime by " + generateHTMLLink(getBaseUrl(), "re-signing up") + " with the same email address." + "<br>"

        const emailBody = "Hi " + name + ", <br><br>Thanks for signing up for Research Rewind! You'll start receiving papers daily at 6am ET.<br>" + editPrefs + generateHTMLLink(feedbackLink, "Feedback?") + "<br>" + generateHTMLLink(unsubscribeLink, "Unsubscribe");
        
        await mg.messages.create('researchrewind.xyz', {
            from: '"Research Rewind" <amulya@researchrewind.xyz>',
            to: [email],
            subject: emailSubject,
            html: emailBody,
        });

        return new Response(JSON.stringify({ success: true }), { status: 201});
    } catch (error) {
        console.error('Error sending confirmation email:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500});
    }
}
