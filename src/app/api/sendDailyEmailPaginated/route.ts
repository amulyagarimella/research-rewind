// src/app/api/sendDailyEmailPaginated/route.ts
import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { Paper, get_papers_batch, UserRequest } from "../sendDailyEmail/get_papers";
import { DateTime } from "ts-luxon";
import { NextRequest, NextResponse } from "next/server";
import { generateUnsubscribeToken, feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

// Track processing state in Firebase
interface ProcessingState {
  date: string;
  totalUsers: number;
  processedUsers: number;
  batchesCompleted: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
  lastProcessedUserId?: string;
  startTime?: number;
}

const BATCH_SIZE = 15; // Conservative batch size for free plan
const MAX_EXECUTION_TIME = 8000; // 8 seconds max to stay under 10s limit

export async function GET(request: NextRequest) {
  const executionStart = Date.now();
  
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = DateTime.now().setZone('America/New_York').toISODate();
    const stateDocRef = dbAdmin.collection('processing_state').doc(today || '');
    
    // Get or initialize processing state
    const state: ProcessingState = await getOrCreateProcessingState(stateDocRef, today || '');
    
    if (state.status === 'completed') {
      return NextResponse.json({ 
        success: true, 
        message: 'Daily emails already completed',
        totalUsers: state.totalUsers,
        processedUsers: state.processedUsers,
        batchesCompleted: state.batchesCompleted
      });
    }

    console.log(`Starting batch processing: ${state.processedUsers}/${state.totalUsers} users processed`);

    let totalBatchesThisRun = 0;
    let totalEmailsSent = 0;
    let totalEmailsFailed = 0;
    const allErrors: string[] = [];

    // Process batches until we run out of time or users
    while (Date.now() - executionStart < MAX_EXECUTION_TIME) {
      // Get next batch of users
      const batchResult = await processBatch(state);
      
      if (batchResult.noMoreUsers) {
        // All users processed - mark as complete
        await stateDocRef.update({
          status: 'completed',
          processedUsers: state.totalUsers,
          batchesCompleted: state.batchesCompleted + totalBatchesThisRun
        });
        
        return NextResponse.json({
          success: true,
          message: 'All daily emails completed!',
          finalStats: {
            totalUsers: state.totalUsers,
            processedUsers: state.totalUsers,
            batchesCompleted: state.batchesCompleted + totalBatchesThisRun,
            batchesThisRun: totalBatchesThisRun,
            emailsSent: totalEmailsSent,
            emailsFailed: totalEmailsFailed,
            executionTime: Date.now() - executionStart
          },
          errors: allErrors
        });
      }

      // Update running totals
      totalBatchesThisRun++;
      totalEmailsSent += batchResult.emailsSent;
      totalEmailsFailed += batchResult.emailsFailed;
      allErrors.push(...batchResult.errors);
      
      // Update state for next iteration
      state.processedUsers += batchResult.usersProcessed;
      state.batchesCompleted += 1;
      state.lastProcessedUserId = batchResult.lastUserId;
      
      console.log(`Batch ${totalBatchesThisRun} complete: ${batchResult.emailsSent} sent, ${state.processedUsers}/${state.totalUsers} total progress`);
      
      // Check if we're running close to time limit
      if (Date.now() - executionStart > MAX_EXECUTION_TIME - 1000) {
        console.log('Approaching time limit, stopping this execution');
        break;
      }
    }

    // Update state in database
    await stateDocRef.update({
      processedUsers: state.processedUsers,
      batchesCompleted: state.batchesCompleted,
      lastProcessedUserId: state.lastProcessedUserId,
      status: state.processedUsers >= state.totalUsers ? 'completed' : 'in_progress'
    });

    // Schedule next execution if not complete
    const isComplete = state.processedUsers >= state.totalUsers;
    if (!isComplete) {
      await scheduleNextExecution();
    }

    return NextResponse.json({
      success: true,
      message: isComplete ? 'Processing complete!' : 'Batch processing continues...',
      progress: {
        totalUsers: state.totalUsers,
        processedUsers: state.processedUsers,
        percentComplete: Math.round((state.processedUsers / state.totalUsers) * 100),
        isComplete
      },
      thisExecution: {
        batchesProcessed: totalBatchesThisRun,
        emailsSent: totalEmailsSent,
        emailsFailed: totalEmailsFailed,
        executionTime: Date.now() - executionStart
      },
      errors: allErrors,
      nextExecution: isComplete ? null : 'Scheduled in 2 minutes'
    });

  } catch (error: any) {
    console.error('Error in paginated email processing:', error);
    
    // Mark as failed
    const today = DateTime.now().setZone('America/New_York').toISODate();
    await dbAdmin.collection('processing_state').doc(today).update({
      status: 'failed'
    });
    
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function getOrCreateProcessingState(stateDocRef: any, today: string): Promise<ProcessingState> {
  const stateDoc = await stateDocRef.get();
  
  if (stateDoc.exists) {
    return stateDoc.data() as ProcessingState;
  } else {
    // Initialize processing state
    const totalUsersSnapshot = await dbAdmin.collection('users')
      .where('subscribed', '==', true)
      .get();
    
    const state: ProcessingState = {
      date: today,
      totalUsers: totalUsersSnapshot.docs.length,
      processedUsers: 0,
      batchesCompleted: 0,
      status: 'in_progress',
      startTime: Date.now()
    };
    
    await stateDocRef.set(state);
    return state;
  }
}

async function processBatch(state: ProcessingState) {
  // Get next batch of users
  let usersQuery = dbAdmin.collection('users')
    .where('subscribed', '==', true)
    .orderBy('email')
    .limit(BATCH_SIZE);

  // Resume from where we left off
  if (state.lastProcessedUserId) {
    const lastUserDoc = await dbAdmin.collection('users').doc(state.lastProcessedUserId).get();
    if (lastUserDoc.exists) {
      usersQuery = usersQuery.startAfter(lastUserDoc);
    }
  }

  const snapshot = await usersQuery.get();
  
  if (snapshot.docs.length === 0) {
    return { noMoreUsers: true, usersProcessed: 0, emailsSent: 0, emailsFailed: 0, errors: [], lastUserId: undefined };
  }

  // Convert to user data
  const users = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  })) as Array<{ id: string; email: string; name: string; intervals: number[]; subjects: string[]; }>;

  // Prepare batch API requests  
  const userRequests: UserRequest[] = users.map(user => ({
    userId: user.email,
    intervals: user.intervals || [1],
    subjects: user.subjects || ["17"]
  }));

  // Get papers for all users in this batch
  const batchResults = await get_papers_batch(userRequests);
  
  // Send emails for this batch
  let emailsSent = 0;
  let emailsFailed = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      const batchResult = batchResults.find(r => r.userId === user.email);
      
      if (!batchResult || batchResult.papers.length === 0) {
        console.log(`No papers found for ${user.email}`);
        continue;
      }

      await sendEmailToUser(user, batchResult.papers);
      emailsSent++;
      
    } catch (error: any) {
      console.error(`Error sending email to ${user.email}:`, error);
      emailsFailed++;
      errors.push(`${user.email}: ${error.message}`);
    }
  }

  return {
    noMoreUsers: false,
    usersProcessed: users.length,
    emailsSent,
    emailsFailed,
    errors,
    lastUserId: snapshot.docs[snapshot.docs.length - 1].id
  };
}

async function scheduleNextExecution() {
  // Use a simple HTTP call to trigger the next execution
  // This runs in 2 minutes to continue processing
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : getBaseUrl();
    
    // Schedule next execution using a simple timeout approach
    // In production, you might want to use a more robust scheduling service
    setTimeout(async () => {
      try {
        await fetch(`${baseUrl}/api/sendDailyEmailPaginated`, {
          headers: {
            'Authorization': `Bearer ${process.env.CRON_SECRET}`
          }
        });
      } catch (error) {
        console.error('Error triggering next execution:', error);
      }
    }, 120000); // 2 minutes
    
    console.log('Next execution scheduled in 2 minutes');
  } catch (error) {
    console.error('Error scheduling next execution:', error);
  }
}

async function sendEmailToUser(userData: any, papers: Paper[]) {
  const unsubscribeToken = generateUnsubscribeToken(userData.email);
  const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${userData.email}&token=${unsubscribeToken}`;
  const emailSubject = `Research Rewind ${DateTime.now().setZone('America/New_York').toISODate()}`;
  
  const paperBody = papers.map((paper: Paper) => 
    `<b>${paper.year_delta} year${paper.year_delta > 1 ? "s" : ""} ago (${paper.publication_date}):</b> ${generateHTMLLink(paper.doi, paper.title)}${formatAuthors(paper.authors)} <br>(Topic: ${paper.main_field})<br><br>`
  ).join("");

  const editPrefs = `Edit your preferences anytime by ${generateHTMLLink(getBaseUrl(), "re-signing up")} with the same email address.<br>`;
  const emailBody = `Hi ${userData.name},<br><br>Here's your research rewind for today.<br><br>${paperBody}${editPrefs}${generateHTMLLink(feedbackLink, "Feedback?")} <br> ${generateHTMLLink(unsubscribeLink, "Unsubscribe")}`;

  await mg.messages.create('researchrewind.xyz', {
    from: '"Research Rewind" <amulya@researchrewind.xyz>',
    to: [userData.email],
    subject: emailSubject,
    html: emailBody,
  });
}

function formatAuthors(authors: string[]) {
  if (authors.length === 0) return "";
  if (authors.length > 3) {
    return " - " + authors.slice(0, 3).join(", ") + ", ..., " + authors.slice(-1);
  }
  return " - " + authors.join(", ");
}