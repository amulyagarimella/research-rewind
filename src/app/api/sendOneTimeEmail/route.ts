// src/app/api/sendOneTimeEmail/route.ts
import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { NextRequest, NextResponse } from "next/server";
import { generateUnsubscribeToken, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

interface OneTimeEmailConfig {
  subject: string;
  htmlBody: string;
  actualSend?: boolean;
  testUserEmail?: string;
  includeUnsubscribe?: boolean;
  includeEditPrefs?: boolean;
  fromName?: string;
  batchSize?: number;
}

export async function POST(request: NextRequest) {
  const logs: string[] = [];
  const originalLog = console.log;
  const startTime = Date.now();
  
  console.log = (...args) => {
    const message = `[${Date.now() - startTime}ms] ${args.join(' ')}`;
    logs.push(message);
    originalLog(...args);
  };

  try {
    const body = await request.json();
    const config: OneTimeEmailConfig = {
      subject: body.subject || 'Message from Research Rewind',
      htmlBody: body.htmlBody || 'No content provided',
      actualSend: body.actualSend || false,
      testUserEmail: body.testUserEmail || process.env.ADMIN_EMAIL || '',
      includeUnsubscribe: body.includeUnsubscribe !== false, // default true
      includeEditPrefs: body.includeEditPrefs !== false, // default true
      fromName: body.fromName || 'Research Rewind',
      batchSize: body.batchSize || 25
    };

    // Validation
    if (!config.subject.trim() || !config.htmlBody.trim()) {
      return NextResponse.json({
        success: false,
        error: 'Subject and htmlBody are required'
      }, { status: 400 });
    }

    console.log(`Sending one-time email: "${config.subject}", actualSend: ${config.actualSend}`);

    // Get all subscribed users
    const emailsRef = dbAdmin.collection('users').where('subscribed', '==', true);
    const snapshot = await emailsRef.get();
    
    console.log(`Found ${snapshot.docs.length} subscribed users`);

    let emailsSent = 0;
    let emailsFailed = 0;
    const errors: string[] = [];
    const MAX_EXECUTION_TIME = 8000; // 8 seconds

    // Process users in batches to avoid timeout
    const users = snapshot.docs.map(doc => doc.data());
    
    for (let i = 0; i < users.length; i += config.batchSize) {
      // Check time limit
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.log(`Stopping due to time limit. Processed ${emailsSent}/${users.length} emails`);
        break;
      }

      const batch = users.slice(i, i + config.batchSize);
      console.log(`Processing batch ${Math.floor(i / config.batchSize) + 1}: ${batch.length} users`);

      // Process batch
      for (const userData of batch) {
        try {
          const targetEmail = config.actualSend ? userData.email : config.testUserEmail;
          
          const emailContent = buildEmailContent(userData, config);
          
          // Send email (or simulate for test)
          if (config.actualSend || (!config.actualSend && targetEmail === config.testUserEmail)) {
            await mg.messages.create('researchrewind.xyz', {
              from: `"${config.fromName}" <amulya@researchrewind.xyz>`,
              to: [targetEmail],
              subject: config.subject,
              html: emailContent,
            });
            
            console.log(`Email sent to ${targetEmail}`);
            emailsSent++;
          } else {
            console.log(`Email simulated for ${userData.email}`);
            emailsSent++;
          }
          
          // Small delay between individual emails
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error: any) {
          console.error(`Error sending email to ${userData.email}:`, error);
          emailsFailed++;
          errors.push(`${userData.email}: ${error.message}`);
        }
      }

      // Delay between batches
      if (i + config.batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log = originalLog;

    return NextResponse.json({
      success: true,
      subject: config.subject,
      totalUsers: users.length,
      emailsSent,
      emailsFailed,
      errors,
      logs,
      executionTime: Date.now() - startTime,
      timeoutWarning: Date.now() - startTime > MAX_EXECUTION_TIME ? 'Execution stopped due to time limit' : null
    });

  } catch (error: any) {
    console.log = originalLog;
    return NextResponse.json({
      success: false,
      error: error.message,
      logs
    }, { status: 500 });
  }
}

function buildEmailContent(userData: any, config: OneTimeEmailConfig): string {
  let emailBody = config.htmlBody;
  
  // Replace common placeholders
  emailBody = emailBody.replace(/\{name\}/g, userData.name || 'there');
  emailBody = emailBody.replace(/\{email\}/g, userData.email);
  
  // Add optional footer elements
  const footerElements: string[] = [];
  
  if (config.includeEditPrefs) {
    const editPrefsLink = generateHTMLLink(getBaseUrl(), "re-signing up");
    footerElements.push(`Edit your preferences anytime by ${editPrefsLink} with the same email address.`);
  }
  
  if (config.includeUnsubscribe) {
    const unsubscribeToken = generateUnsubscribeToken(userData.email);
    const unsubscribeLink = `${getBaseUrl()}/api/unsubscribe?email=${userData.email}&token=${unsubscribeToken}`;
    footerElements.push(generateHTMLLink(unsubscribeLink, "Unsubscribe"));
  }
  
  // Add footer if any elements exist
  if (footerElements.length > 0) {
    emailBody += '<br><br>' + footerElements.join('<br>');
  }
  
  return emailBody;
}