import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { Paper, get_papers } from "./get_papers";
import { DateTime } from "ts-luxon";
import { NextRequest } from "next/server";
import { feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

function formatAuthors(authors:string[]) {
    if (authors.length === 0) {
        return "";
    }
    if (authors.length > 3) {
        return " - " + authors.slice(0, 3).join(", ") + ", ..., " + authors.slice(-1);
    }
    return " - " + authors.join(", ");
}

// Add delay between API requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new Response('Unauthorized', {
            status: 401,
            });
        }
        
        // ADMIN ONLY MODE - Add this check
        const isAdminOnly = process.env.SEND_TO_ADMIN_ONLY === 'true';
        const adminEmail = process.env.ADMIN_EMAIL;
        
        if (isAdminOnly && !adminEmail) {
            console.error('ADMIN_EMAIL not set while in admin-only mode');
            return new Response('Configuration error', { status: 500 });
        }

        let emailsRef;
        if (isAdminOnly) {
            // Only fetch admin user in test mode
            emailsRef = dbAdmin.collection('users')
                .where('subscribed', '==', true)
                .where('email', '==', adminEmail);
        } else {
            // Normal mode - all subscribed users
            emailsRef = dbAdmin.collection('users').where('subscribed', '==', true);
        }
        
        const snapshot = await emailsRef.get();
        console.log(`Processing ${snapshot.docs.length} users ${isAdminOnly ? '(ADMIN ONLY MODE)' : ''}`);

        let lastBody = "";

        
        // CRITICAL FIX: Process users sequentially, not with map
        for (const doc of snapshot.docs) {
            const emailData = doc.data();
            console.log(`Processing user: ${emailData.email}`);
            
            try {
                const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${emailData.email}}`;

                const papers = await get_papers(emailData.intervals, emailData.subjects);

                if (papers.length === 0) {
                    console.log(`No papers found for ${emailData.email}`);
                    continue;
                }

                const emailSubject = "Research Rewind " + DateTime.now().setZone('America/New_York').toISODate();
     
                const paperBody = papers.map((paper : Paper) => 
                    "<b>" + paper.year_delta + " year" + (paper.year_delta > 1 ? "s" : "") + " ago (" + paper.publication_date + "):</b> " + generateHTMLLink(paper.doi, paper.title) + formatAuthors(paper.authors) + " <br>(Topic: " + paper.main_field + ")<br><br>"
                ).join("");

                const editPrefs = "Edit your preferences anytime by " + generateHTMLLink(getBaseUrl(), "re-signing up") + " with the same email address." + "<br>";

                const emailBody = "Hi " + emailData.name + ",<br><br>Here's your research rewind for today.<br><br>" + paperBody + editPrefs + generateHTMLLink(feedbackLink, "Feedback?") + "<br>" + generateHTMLLink(unsubscribeLink, "Unsubscribe");

                await mg.messages.create('researchrewind.xyz', {
                    from: '"Research Rewind" <amulya@researchrewind.xyz>',
                    to: [ emailData.email ],
                    subject: emailSubject,
                    html: emailBody,
                });

                lastBody = emailBody;
                
                console.log(`Email sent successfully to ${emailData.email}`);
                
                // Add delay between users to avoid overwhelming APIs
                await delay(500); // 500ms between users
                
            } catch (userError) {
                console.error(`Error processing user ${emailData.email}:`, userError);
                // Continue processing other users
            }
        }

        return new Response(JSON.stringify({ 
            success: true, 
            processed: snapshot.docs.length,
            mode: isAdminOnly ? 'admin-only' : 'production',
            lastBody: lastBody,
        }), { status: 201});
    } catch (error) {
        console.error('Error sending emails:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500});
    }
}