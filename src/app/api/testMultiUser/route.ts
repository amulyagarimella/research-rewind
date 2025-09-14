// src/app/api/testMultiUser/route.ts
import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { Paper, get_papers_batch, UserRequest } from "../sendDailyEmail/get_papers";
import { DateTime } from "ts-luxon";
import { NextRequest } from "next/server";
import { generateUnsubscribeToken, feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

interface TestConfig {
    userCount?: number;
    actualSend?: boolean;
    testUserEmail?: string;
    useBatching?: boolean;
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
            testUserEmail: body.testUserEmail || process.env.ADMIN_EMAIL,
            useBatching: body.useBatching !== false // default to true
        };

        console.log(`Starting multi-user test: ${config.userCount} users, actualSend: ${config.actualSend}, batching: ${config.useBatching}`);

        // Get users from DB
        const emailsRef = dbAdmin.collection('users')
            .where('subscribed', '==', true)
            .limit(config.userCount || 1);
        
        
        const snapshot = await emailsRef.get();
        const realUsers = snapshot.docs.map(doc => doc.data());
        const syntheticUsers = generateSyntheticUsers(realUsers, config.userCount || 1);
        
        console.log(`Found ${syntheticUsers.length} users in database`);

        // Track metrics
        const metrics = {
            totalUsers: syntheticUsers.length,
            successfulEmails: 0,
            failedEmails: 0,
            totalApiRequests: 0,
            uniqueApiRequests: 0,
            apiRequestTime: 0,
            emailSendTime: 0,
            cacheHitRate: 0,
            errors: [] as string[]
        };

        if (config.useBatching) {
            // BATCHED APPROACH
            console.log("Using batched API approach");
            
            // Prepare batch requests
            const userRequests: UserRequest[] = syntheticUsers.map(doc => {
                const data = doc.data();
                return {
                    userId: data.email,
                    intervals: data.intervals,
                    subjects: data.subjects
                };
            });

            // Execute batch
            const batchStart = Date.now();
            const batchResults = await get_papers_batch(userRequests);
            metrics.apiRequestTime = Date.now() - batchStart;

            // Calculate metrics
            metrics.totalApiRequests = batchResults.reduce((sum, result) => sum + result.apiCallsUsed, 0);
            metrics.uniqueApiRequests = metrics.totalApiRequests; // Already deduplicated

            // Send emails
            for (let i = 0; i < syntheticUsers.length; i++) {
                const doc = syntheticUsers[i];
                const emailData = doc.data();
                const batchResult = batchResults.find(r => r.userId === emailData.email);
                
                if (!batchResult || batchResult.papers.length === 0) {
                    console.log(`No papers found for ${emailData.email}`);
                    continue;
                }

                try {
                    await sendEmail(emailData, batchResult.papers, config, metrics);
                } catch (error) {
                    console.error(`Error sending email to ${emailData.email}:`, error);
                    metrics.failedEmails++;
                    metrics.errors.push(`${emailData.email}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

        } else {
            // SEQUENTIAL APPROACH (original)
            console.log("Using sequential API approach");
            
            for (let i = 0; i < syntheticUsers.length; i++) {
                const doc = syntheticUsers[i];
                const emailData = doc.data();
                
                console.log(`Processing user ${i + 1}/${syntheticUsers.length}: ${emailData.email}`);
                
                try {
                    // Time API requests (old way)
                    const apiStart = Date.now();
                    const { get_papers } = await import("../sendDailyEmail/get_papers");
                    const papers = await get_papers(emailData.intervals, emailData.subjects);
                    const apiTime = Date.now() - apiStart;
                    
                    metrics.totalApiRequests += emailData.intervals.length;
                    metrics.apiRequestTime += apiTime;
                    
                    if (papers.length === 0) {
                        console.log(`No papers found for ${emailData.email}`);
                        continue;
                    }

                    await sendEmail(emailData, papers, config, metrics);
                    
                    // Rate limiting between users
                    if (i < syntheticUsers.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    
                } catch (userError) {
                    console.error(`Error processing user ${emailData.email}:`, userError);
                    metrics.failedEmails++;
                    metrics.errors.push(`${emailData.email}: ${userError instanceof Error ? userError.message : String(userError)}`);
                }
            }
        }

        const totalTime = Date.now() - startTime;
        metrics.cacheHitRate = metrics.totalApiRequests > 0 ? 
            ((metrics.totalApiRequests - metrics.uniqueApiRequests) / metrics.totalApiRequests) * 100 : 0;

        console.log(`Test completed in ${totalTime}ms`);
        console.log(`API efficiency: ${metrics.totalApiRequests} potential requests → ${metrics.uniqueApiRequests} actual requests`);
        console.log(`Cache hit rate: ${metrics.cacheHitRate.toFixed(1)}%`);

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
                apiEfficiencyRatio: metrics.totalApiRequests > 0 ? metrics.uniqueApiRequests / metrics.totalApiRequests : 1
            },
            logs
        }), { status: 200 });

    } catch (error) {
        console.log = originalLog;
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            logs
        }), { status: 500 });
    }
}

function generateSyntheticUsers(realUsers: any[], targetCount: number): any[] {
    if (realUsers.length === 0) {
        throw new Error("Need at least one real user in database to generate synthetic users");
    }
    
    if (realUsers.length >= targetCount) {
        return realUsers.slice(0, targetCount);
    }
    
    const syntheticUsers = [...realUsers];
    
    // Common interval patterns for variety
    const intervalPatterns = [
        [1, 5],
        [1, 10],
        [5, 10, 50],
        [1, 5, 10],
        [10, 50],
        [1],
        [5],
        [10],
        [1, 5, 10, 50],
        [50, 100]
    ];
    
    // Common subject combinations (using OpenAlex field IDs)
    const subjectPatterns = [
        ["17"], // Computer Science
        ["16"], // Chemistry  
        ["27"], // Medicine
        ["17", "26"], // Computer Science + Math
        ["16", "25"], // Chemistry + Materials Science
        ["27", "13"], // Medicine + Biochemistry
        ["17", "22"], // Computer Science + Engineering
        ["19"], // Earth Sciences
        ["31"], // Physics
        ["17", "31"] // Computer Science + Physics
    ];
    
    let userIndex = 0;
    while (syntheticUsers.length < targetCount) {
        const baseUser = realUsers[userIndex % realUsers.length];
        const userNum = syntheticUsers.length + 1;
        
        const syntheticUser = {
            ...baseUser,
            name: `Test User ${userNum}`,
            email: `synthetic.user.${userNum}@test.com`,
            intervals: intervalPatterns[userNum % intervalPatterns.length],
            subjects: subjectPatterns[userNum % subjectPatterns.length]
        };
        
        syntheticUsers.push(syntheticUser);
        userIndex++;
    }
    
    return syntheticUsers;
}

async function sendEmail(emailData: any, papers: Paper[], config: TestConfig, metrics: any) {
    const emailStart = Date.now();
    
    const unsubscribeToken = generateUnsubscribeToken(emailData.email);
    const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${emailData.email}&token=${unsubscribeToken}`;
    const emailSubject = `[TEST${config.useBatching ? '-BATCHED' : '-SEQUENTIAL'}] Research Rewind ${DateTime.now().setZone('America/New_York').toISODate()}`;
    
    const paperBody = papers.map((paper: Paper) => 
        `<b>${paper.year_delta} year${paper.year_delta > 1 ? "s" : ""} ago (${paper.publication_date}):</b> ${generateHTMLLink(paper.doi, paper.title)}${formatAuthors(paper.authors)} <br>(Topic: ${paper.main_field})<br><br>`
    ).join("");

    const editPrefs = `Edit your preferences anytime by ${generateHTMLLink(getBaseUrl(), "re-signing up")} with the same email address.<br>`;
    const emailBody = `Hi ${emailData.name},<br><br>[TEST EMAIL - User: ${emailData.email}] Here's your research rewind for today.<br><br>${paperBody}${editPrefs}${generateHTMLLink(feedbackLink, "Feedback?")} <br> ${generateHTMLLink(unsubscribeLink, "Unsubscribe")}`;

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
}

function formatAuthors(authors: string[]) {
    if (authors.length === 0) return "";
    if (authors.length > 3) {
        return " - " + authors.slice(0, 3).join(", ") + ", ..., " + authors.slice(-1);
    }
    return " - " + authors.join(", ");
}