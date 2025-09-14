// src/app/api/testPaginatedEmails/route.ts
import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { Paper, get_papers_batch, UserRequest } from "../sendDailyEmail/get_papers";
import { DateTime } from "ts-luxon";
import { NextRequest, NextResponse } from "next/server";
import { generateUnsubscribeToken, feedbackLink, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

interface UserData {
  id?: string;
  name: string;
  email: string;
  subscribed: boolean;
  subjects: string[];
  intervals: number[];
  timezone: string;
}

interface TestConfig {
  userCount?: number;
  actualSend?: boolean;
  testUserEmail?: string;
  batchSize?: number;
}

interface ProcessingState {
  totalUsers: number;
  processedUsers: number;
  batchesCompleted: number;
  status: 'in_progress' | 'completed';
  syntheticUsers: UserData[];
  currentBatchIndex: number;
}

const MAX_EXECUTION_TIME = 8000; // 8 seconds max

export async function POST(request: NextRequest) {
  const logs: string[] = [];
  const originalLog = console.log;
  const executionStart = Date.now();
  
  // Capture logs
  console.log = (...args) => {
    const timestamp = Date.now() - executionStart;
    const message = `[${timestamp}ms] ${args.join(' ')}`;
    logs.push(message);
    originalLog(...args);
  };

  try {
    const body = await request.json();
    const config: TestConfig = {
      userCount: body.userCount || 20,
      actualSend: body.actualSend || false,
      testUserEmail: body.testUserEmail || process.env.ADMIN_EMAIL || '',
      batchSize: body.batchSize || 15
    };

    console.log(`Starting paginated test: ${config.userCount} users, batchSize: ${config.batchSize}, actualSend: ${config.actualSend}`);

    // Get or create processing state (stored in memory for this test)
    // const testId = `test-${Date.now()}`;
    // const stateKey = `test_state_${testId}`;
    
    let state: ProcessingState;
    
    // For testing, we'll simulate the state in the request body or create new
    if (body.continueFromState) {
      state = body.continueFromState;
      console.log(`Continuing from previous state: batch ${state.batchesCompleted + 1}`);
    } else {
      // Initialize new test - generate synthetic users
      const realUsers = await getRealUsers();
      const syntheticUsers = generateSyntheticUsers(realUsers, config.userCount || 20);
      
      state = {
        totalUsers: syntheticUsers.length,
        processedUsers: 0,
        batchesCompleted: 0,
        status: 'in_progress',
        syntheticUsers,
        currentBatchIndex: 0
      };
      
      console.log(`Initialized test with ${syntheticUsers.length} synthetic users`);
    }

    let totalBatchesThisRun = 0;
    let totalEmailsSent = 0;
    let totalEmailsFailed = 0;
    const allErrors: string[] = [];

    // Process batches until we run out of time or users
    while (Date.now() - executionStart < MAX_EXECUTION_TIME && state.currentBatchIndex < state.syntheticUsers.length) {
      const batchSize = config.batchSize || 15;
      const batchStart = state.currentBatchIndex;
      const batchEnd = Math.min(batchStart + batchSize, state.syntheticUsers.length);
      const batchUsers = state.syntheticUsers.slice(batchStart, batchEnd);
      
      console.log(`Processing batch ${totalBatchesThisRun + 1}: users ${batchStart + 1}-${batchEnd}`);

      // Process this batch
      const batchResult = await processBatch(batchUsers, config);
      
      // Update running totals
      totalBatchesThisRun++;
      totalEmailsSent += batchResult.emailsSent;
      totalEmailsFailed += batchResult.emailsFailed;
      allErrors.push(...batchResult.errors);
      
      // Update state for next iteration
      state.processedUsers += batchUsers.length;
      state.batchesCompleted += 1;
      state.currentBatchIndex = batchEnd;
      
      console.log(`Batch ${totalBatchesThisRun} complete: ${batchResult.emailsSent} sent, ${state.processedUsers}/${state.totalUsers} total progress`);
      
      // Check if we're running close to time limit
      if (Date.now() - executionStart > MAX_EXECUTION_TIME - 1000) {
        console.log('Approaching time limit, stopping this execution');
        break;
      }
    }

    // Check if complete
    const isComplete = state.currentBatchIndex >= state.syntheticUsers.length;
    state.status = isComplete ? 'completed' : 'in_progress';

    // Restore console.log
    console.log = originalLog;

    const response = {
      success: true,
      message: isComplete ? 'All test emails completed!' : 'Batch processing continues...',
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
      logs,
      // Include state for continuation
      continueFromState: isComplete ? null : state,
      nextExecutionCommand: isComplete ? null : {
        message: "To continue processing, run the same curl command with this added to the JSON body:",
        continueFromState: state
      }
    };

    return NextResponse.json(response);

  } catch (error: any) {
    console.log = originalLog;
    return NextResponse.json({
      success: false,
      error: error.message,
      logs
    }, { status: 500 });
  }
}

async function getRealUsers(): Promise<UserData[]> {
  const emailsRef = dbAdmin.collection('users').where('subscribed', '==', true);
  const snapshot = await emailsRef.get();
  
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name || 'Unknown',
      email: data.email || '',
      subscribed: data.subscribed || true,
      subjects: Array.isArray(data.subjects) ? data.subjects : ["17"],
      intervals: Array.isArray(data.intervals) ? data.intervals : [1],
      timezone: data.timezone || 'UTC'
    };
  });
}

function generateSyntheticUsers(realUsers: UserData[], targetCount: number): UserData[] {
  if (realUsers.length === 0) {
    // Create a default user if no real users exist
    realUsers = [{
      name: 'Default User',
      email: 'default@test.com',
      subscribed: true,
      subjects: ['17'],
      intervals: [1],
      timezone: 'UTC'
    }];
  }
  
  if (realUsers.length >= targetCount) {
    return realUsers.slice(0, targetCount);
  }
  
  const syntheticUsers: UserData[] = [...realUsers];
  
  // Varied patterns for testing cache efficiency
  const intervalPatterns: number[][] = [
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
  
  const subjectPatterns: string[][] = [
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
    
    const syntheticUser: UserData = {
      ...baseUser,
      id: `synthetic-${userNum}`,
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

async function processBatch(users: UserData[], config: TestConfig) {
  // Prepare batch API requests  
  const userRequests: UserRequest[] = users.map(user => ({
    userId: user.email,
    intervals: user.intervals,
    subjects: user.subjects
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

      await sendEmailToUser(user, batchResult.papers, config);
      emailsSent++;
      
    } catch (error: any) {
      console.error(`Error sending email to ${user.email}:`, error);
      emailsFailed++;
      errors.push(`${user.email}: ${error.message}`);
    }
  }

  return { emailsSent, emailsFailed, errors };
}

async function sendEmailToUser(userData: UserData, papers: Paper[], config: TestConfig) {
  const unsubscribeToken = generateUnsubscribeToken(userData.email);
  const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${userData.email}&token=${unsubscribeToken}`;
  const emailSubject = `[TEST-PAGINATED] Research Rewind ${DateTime.now().setZone('America/New_York').toISODate()}`;
  
  const paperBody = papers.map((paper: Paper) => 
    `<b>${paper.year_delta} year${paper.year_delta > 1 ? "s" : ""} ago (${paper.publication_date}):</b> ${generateHTMLLink(paper.doi, paper.title)}${formatAuthors(paper.authors)} <br>(Topic: ${paper.main_field})<br><br>`
  ).join("");

  const editPrefs = `Edit your preferences anytime by ${generateHTMLLink(getBaseUrl(), "re-signing up")} with the same email address.<br>`;
  const emailBody = `Hi ${userData.name},<br><br>[TEST PAGINATED EMAIL - User: ${userData.email}] Here's your research rewind for today.<br><br>${paperBody}${editPrefs}${generateHTMLLink(feedbackLink, "Feedback?")} <br> ${generateHTMLLink(unsubscribeLink, "Unsubscribe")}`;

  if (config.actualSend) {
    const targetEmail = config.testUserEmail;
    await mg.messages.create('researchrewind.xyz', {
      from: '"Research Rewind TEST" <amulya@researchrewind.xyz>',
      to: [targetEmail || ''],
      subject: emailSubject,
      html: emailBody,
    });
    console.log(`Email sent to ${targetEmail}`);
  } else {
    console.log(`Email simulated for ${userData.email} (${emailBody.length} chars)`);
  }
}

function formatAuthors(authors: string[]) {
  if (authors.length === 0) return "";
  if (authors.length > 3) {
    return " - " + authors.slice(0, 3).join(", ") + ", ..., " + authors.slice(-1);
  }
  return " - " + authors.join(", ");
}