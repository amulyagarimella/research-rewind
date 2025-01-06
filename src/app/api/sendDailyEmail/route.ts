import { dbAdmin } from "../../../lib/firebaseAdmin";
import { transporter } from "../../../lib/nodemailer";
import { Paper, get_papers } from "./get_papers";
import { DateTime } from "ts-luxon";
import crypto from 'crypto';

function generateUnsubscribeToken(email:string) {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    return crypto.createHash('sha256').update(`${email}${secret}`).digest('hex');
}
const feedbackLink="https://tally.so/r/3X10Y4"

function generateHTMLLink(link:string, text:string) {
    return "<a href=\"" + link + "\"  target=\"_blank\" rel=\"noopener noreferrer\">" + text + "</a>";
}

function formatAuthors(authors:string[]) {
    if (authors.length > 3) {
        return authors.slice(0, 3).join(", ") + ", ..., " + authors.slice(-1);
    }
    return authors.join(", ");
}

const getBaseUrl = () => {
    if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" || process.env.NEXT_PUBLIC_VERCEL_ENV === "production") {
        return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
    }
    return "http://localhost:3000";
};

export async function POST() {
    try {
        const emailsRef = dbAdmin.collection('users').where('subscribed', '==', true);
        const snapshot = await emailsRef.get();
        // console.log("DEBUG - snapshot: ", snapshot);
        const emailPromises = snapshot.docs.map(async (doc) => {
            const emailData = doc.data();
            const unsubscribeToken = generateUnsubscribeToken(emailData.email);
            const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${emailData.email}&token=${unsubscribeToken}`;

            const papers = await get_papers(emailData.intervals, emailData.subjects);

            // console.log("DEBUG", papers);

            if (papers.length === 0) {
                return;
            }

            const emailSubject = "Research Rewind " + DateTime.now().setZone('America/New_York').toISODate() + " 🔬⏪";
 
            const paperBody = papers.map((paper : Paper) => 
                "<b>" + paper.year_delta + " year" + (paper.year_delta > 1 ? "s" : "") + " ago (" + paper.publication_date + "):</b> " + generateHTMLLink(paper.doi, paper.title) + " - " + formatAuthors(paper.authors) + " <br>(Topic: " + paper.main_field + ")<br><br>"
            ).join("");

            // console.log("DEBUG - paper body", paperBody)

            const editPrefs = "<br><br>" + "Edit your preferences anytime by " + generateHTMLLink(getBaseUrl(), "re-signing up") + " with the same email address." + "<br><br>"

            const emailBody = "Hi " + emailData.name + ",<br><br>Here's your research rewind for today.<br><br>" + paperBody + editPrefs + generateHTMLLink(feedbackLink, "Feedback?") + "<br><br>" + generateHTMLLink(unsubscribeLink, "Unsubscribe");

            // console.log("DEBUG - email HTML", emailBody);
            
            await transporter.sendMail({
                from: process.env.EMAIL_ADDRESS,
                to: emailData.email,
                subject: emailSubject,
                html: emailBody,
            });
        });

        await Promise.all(emailPromises);
        return new Response(JSON.stringify({ success: true }), { status: 201});
    } catch (error) {
        console.error('Error sending emails:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500});
    }
}
