// src/app/api/testMultiUser/route.ts
import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { Paper, get_papers } from "../sendDailyEmail/get_papers";
import { DateTime } from "ts-luxon";
import { NextRequest } from "next/server";
import { generateUnsubscribeToken, feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

interface TestConfig {
    userCount?: number;
    actualSend?: boolean;
    testUserEmail?: string;
}

export async function POST(request: NextRequest) {
    const logs: string[] = [];
    const originalLog = console.log;
    const startTime = Date.now();
    
    // Capture logs
    console.log = (...args) => {
        const timestamp = Date.now() - startTime;
        const message = `[${timestamp}ms] ${args.join(' ')}`;
        logs.push(message);
        originalLog(...args);
    };

    try {
        const body = await request.json();
        const config: TestConfig = {
            userCount: body.userCount || 10,
            actualSend: body.actualSend || false,
            testUserEmail: body.testUserEmail || process.env.ADMIN_EMAIL
        };

        console.log(`Starting multi-user test: ${config.userCount} users, actualSend: ${config.actualSend}`);

        // Get real users from DB but limit the count
        const emailsRef = dbAdmin.collection('users')
            .where('subscribed', '==', true)
            .limit(config.userCount || 1);
        
        const snapshot = await emailsRef.get();
        console.log(`Found ${snapshot.docs.length} users in database`);

        // Track metrics
        const metrics = {
            totalUsers: snapshot.docs.length,
            successfulEmails: 0,
            failedEmails: 0,
            totalApiRequests: 0,
            apiRequestTime: 0,
            emailSendTime: 0,
            errors: [] as string[]
        };

        // Process users sequentially
        for (let i = 0; i < snapshot.docs.length; i++) {
            const doc = snapshot.docs[i];
            const emailData = doc.data();
            
            console.log(`Processing user ${i + 1}/${snapshot.docs.length}: ${emailData.email}`);
            
            try {
                // Time API requests
                const apiStart = Date.now();
                const papers = await get_papers(emailData.intervals, emailData.subjects);
                const apiTime = Date.now() - apiStart;
                
                metrics.totalApiRequests += emailData.intervals.length;
                metrics.apiRequestTime += apiTime;
                
                console.log(`API requests took ${apiTime}ms for ${emailData.intervals.length} requests`);

                if (papers.length === 0) {
                    console.log(`No papers found for ${emailData.email}`);
                    continue;
                }

                // Build email content
                const unsubscribeToken = generateUnsubscribeToken(emailData.email);
                const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${emailData.email}&token=${unsubscribeToken}`;
                const emailSubject = `[TEST] Research Rewind ${DateTime.now().setZone('America/New_York').toISODate()}`;
                
                const paperBody = papers.map((paper: Paper) => 
                    `<b>${paper.year_delta} year${paper.year_delta > 1 ? "s" : ""} ago (${paper.publication_date}):</b> ${generateHTMLLink(paper.doi, paper.title)}${formatAuthors(paper.authors)} <br>(Topic: ${paper.main_field})<br><br>`
                ).join("");

                const editPrefs = `Edit your preferences anytime by ${generateHTMLLink(getBaseUrl(), "re-signing up")} with the same email address.<br>`;
                const emailBody = `Hi ${emailData.name},<br><br>[TEST EMAIL] Here's your research rewind for today.<br><br>${paperBody}${editPrefs}${generateHTMLLink(feedbackLink, "Feedback?")} <br> ${generateHTMLLink(unsubscribeLink, "Unsubscribe")}`;

                // Send email (or simulate)
                const emailStart = Date.now();
                if (config.actualSend) {
                    const targetEmail = config.testUserEmail || emailData.email;
                    await mg.messages.create('researchrewind.xyz', {
                        from: '"Research Rewind TEST" <amulya@researchrewind.xyz>',
                        to: [targetEmail],
                        subject: emailSubject,
                        html: emailBody,
                    });
                    console.log(`Email sent to ${targetEmail}`);
                } else {
                    console.log(`Email simulated for ${emailData.email} (${emailBody.length} chars)`);
                }
                
                const emailTime = Date.now() - emailStart;
                metrics.emailSendTime += emailTime;
                metrics.successfulEmails++;
                
                // Rate limiting between users
                if (i < snapshot.docs.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (userError) {
                console.error(`Error processing user ${emailData.email}:`, userError);
                metrics.failedEmails++;
                metrics.errors.push(`${emailData.email}: ${userError instanceof Error ? userError.message : String(userError)}`);
            }
        }

        const totalTime = Date.now() - startTime;
        console.log(`Test completed in ${totalTime}ms`);
        console.log(`Metrics: ${JSON.stringify(metrics, null, 2)}`);

        // Restore console.log
        console.log = originalLog;

        return new Response(JSON.stringify({
            success: true,
            config,
            metrics: {
                ...metrics,
                totalExecutionTime: totalTime,
                avgApiTimePerUser: metrics.apiRequestTime / metrics.totalUsers,
                avgEmailTimePerUser: metrics.emailSendTime / metrics.totalUsers,
                avgApiTimePerRequest: metrics.apiRequestTime / metrics.totalApiRequests
            },
            logs
        }), { status: 200 });

    } catch (error) {
        console.log = originalLog;
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            logs
        }), { status: 500 });
    }
}

function formatAuthors(authors: string[]) {
    if (authors.length === 0) return "";
    if (authors.length > 3) {
        return " - " + authors.slice(0, 3).join(", ") + ", ..., " + authors.slice(-1);
    }
    return " - " + authors.join(", ");
}