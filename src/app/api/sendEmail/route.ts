import { dbAdmin } from "../../../lib/firebaseAdmin";
import { transporter } from "../../../lib/nodemailer";
import crypto from 'crypto';

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function generateUnsubscribeToken(email:string) {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    return crypto.createHash('sha256').update(`${email}${secret}`).digest('hex');
}
const feedbackLink="https://tally.so/r/3X10Y4"

function generateHTMLLink(link:string, text:string) {
    return "<a href=\"" + link + "\"  target=\"_blank\" rel=\"noopener noreferrer\">" + text + "</a>";
}

export async function POST(request: Request) {
    try {
        console.log("DEBUG - request: ", request);
        const emailsRef = dbAdmin.collection('users').where('subscribed', '==', true);
        const snapshot = await emailsRef.get();
        console.log("DEBUG - snapshot: ", snapshot);
        const emailPromises = snapshot.docs.map(async (doc) => {
            const emailData = doc.data();
            const unsubscribeToken = generateUnsubscribeToken(emailData.email);
            const unsubscribeLink = `${process.env.NEXT_PUBLIC_BASE_URL}/api/unsubscribe?email=${emailData.email}&token=${unsubscribeToken}`;

            // generate subj and body
            const pyinputs = { "yeardeltas": emailData.intervals, "fields": emailData.subjects };
            const { stdout, stderr } = await execAsync(`python src/python/get_papers.py '${JSON.stringify(pyinputs)}'`);
            
            if (stderr) {
                console.error('Python script error:', stderr);
                return new Response(JSON.stringify({ success: false }), { status: 500});
            }

            const emailContent = JSON.parse(stdout);
            // console.log("DEBUG - email content: ", emailContent);
            if (!emailContent.subject || !emailContent.body) {
                console.error('Python script did not return expected content:', emailContent);
                return new Response(JSON.stringify({ success: false }), { status: 500}); 
            }

            const editPrefs = process.env.NEXT_PUBLIC_BASE_URL ? "Edit your preferences anytime by " + generateHTMLLink(process.env.NEXT_PUBLIC_BASE_URL, "re-signing up") + " with the same email address." : "";
            
            await transporter.sendMail({
                from: process.env.EMAIL_ADDRESS,
                to: emailData.email,
                subject: emailContent.subject,
                html: "Hi " + emailData.name + ",<br><br>Here's your research rewind for today.<br><br>" + emailContent.body + "<br><br>" + editPrefs + "<br><br>" + generateHTMLLink(feedbackLink, "I'd love your (anonymous) feedback.") + "<br><br>" + generateHTMLLink(unsubscribeLink, "Unsubscribe")
            });
        });

        await Promise.all(emailPromises);
        return new Response(JSON.stringify({ success: true }), { status: 201});
    } catch (error) {
        console.error('Error sending emails:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500});
    }
}
