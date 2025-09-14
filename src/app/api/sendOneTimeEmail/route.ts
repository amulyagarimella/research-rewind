// src/app/api/sendOneTimeEmail/route.ts
import { dbAdmin } from "../../../lib/firebaseAdmin";
import { mg } from "../../../lib/mailgun";
import { NextRequest, NextResponse } from "next/server";
import { generateUnsubscribeToken, generateHTMLLink, getBaseUrl } from "../../../lib/emailHelpers";

interface OneTimeEmailConfig {
  subject: string;
  htmlBody: string;
  mode: 'preview' | 'test' | 'send';
  testUserEmail?: string;
  includeUnsubscribe?: boolean;
  includeEditPrefs?: boolean;
  fromName?: string;
  batchSize?: number;
  confirmationCode?: string;
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
      mode: body.mode || 'preview',
      testUserEmail: body.testUserEmail || process.env.ADMIN_EMAIL || '',
      includeUnsubscribe: body.includeUnsubscribe !== false,
      includeEditPrefs: body.includeEditPrefs !== false,
      fromName: body.fromName || 'Research Rewind',
      batchSize: body.batchSize || 25,
      confirmationCode: body.confirmationCode
    };

    // Validation
    if (!config.subject.trim() || !config.htmlBody.trim()) {
      return NextResponse.json({
        success: false,
        error: 'Subject and htmlBody are required'
      }, { status: 400 });
    }

    if (!['preview', 'test', 'send'].includes(config.mode)) {
      return NextResponse.json({
        success: false,
        error: 'Mode must be "preview", "test", or "send"'
      }, { status: 400 });
    }

    console.log(`One-time email mode: ${config.mode}, subject: "${config.subject}"`);

    // Get all subscribed users
    const emailsRef = dbAdmin.collection('users').where('subscribed', '==', true);
    const snapshot = await emailsRef.get();
    console.log(`Found ${snapshot.docs.length} subscribed users`);

    // PREVIEW MODE - Draft emails for each user but don't send
    if (config.mode === 'preview') {
      console.log('Generating email previews for all users...');
      
      const users = snapshot.docs.map(doc => doc.data());
      const previews = [];
      
      // Limit preview to first 10 users to avoid huge responses
      const previewLimit = Math.min(users.length, 10);
      
      for (let i = 0; i < previewLimit; i++) {
        const userData = users[i];
        const emailContent = buildEmailContent(userData, config);
        
        previews.push({
          userIndex: i + 1,
          userName: userData.name || 'Unknown',
          userEmail: userData.email,
          userIntervals: userData.intervals || [],
          userSubjects: userData.subjects || [],
          emailSubject: config.subject,
          emailContent: emailContent,
          emailLength: emailContent.length
        });
        
        console.log(`Preview ${i + 1}: ${userData.name} (${userData.email})`);
      }
      
      console.log = originalLog;
      
      return NextResponse.json({
        success: true,
        mode: 'preview',
        subject: config.subject,
        totalUsers: users.length,
        previewsShown: previewLimit,
        message: `Generated email previews for ${previewLimit} users. No emails were sent.`,
        emailPreviews: previews,
        truncated: users.length > previewLimit ? {
          message: `Showing first ${previewLimit} of ${users.length} users`,
          remaining: users.length - previewLimit
        } : null,
        nextSteps: {
          toTest: 'Use mode: "test" to send one email to testUserEmail',
          toSendAll: 'Use mode: "send" with the required confirmationCode'
        },
        logs
      });
    }

    // TEST MODE - Send to test email only
    if (config.mode === 'test') {
      if (!config.testUserEmail) {
        return NextResponse.json({
          success: false,
          error: 'testUserEmail required for test mode'
        }, { status: 400 });
      }

      const sampleUser = snapshot.docs.length > 0 ? 
        snapshot.docs[0].data() : 
        { name: 'Test User', email: config.testUserEmail };
      
      const emailContent = buildEmailContent(sampleUser, config);

      await mg.messages.create('researchrewind.xyz', {
        from: `"${config.fromName} [TEST]" <amulya@researchrewind.xyz>`,
        to: [config.testUserEmail],
        subject: `[TEST] ${config.subject}`,
        html: emailContent,
      });

      console.log(`Test email sent to ${config.testUserEmail}`);
      console.log = originalLog;

      const expectedCode = generateConfirmationCode(config.subject);

      return NextResponse.json({
        success: true,
        mode: 'test',
        subject: config.subject,
        totalUsers: snapshot.docs.length,
        emailsSent: 1,
        testEmailSentTo: config.testUserEmail,
        message: 'Test email sent successfully. Check your inbox.',
        nextSteps: {
          toSendAll: `To send to all ${snapshot.docs.length} users, use mode: "send" with confirmationCode: "${expectedCode}"`
        },
        logs
      });
    }

    // SEND MODE - Send to all users (requires confirmation code)
    if (config.mode === 'send') {
      const expectedCode = generateConfirmationCode(config.subject);
      
      if (config.confirmationCode !== expectedCode) {
        return NextResponse.json({
          success: false,
          error: 'Invalid confirmation code for send mode',
          requiredCode: expectedCode,
          hint: 'Use this exact confirmationCode in your request to send to all users',
          totalUsersWhoWouldReceiveEmail: snapshot.docs.length
        }, { status: 403 });
      }

      console.log(`CONFIRMED: Sending to all ${snapshot.docs.length} users`);

      let emailsSent = 0;
      let emailsFailed = 0;
      const errors: string[] = [];
      const MAX_EXECUTION_TIME = 8000;
      const batchSize = config.batchSize || 5;

      // Process users in batches to avoid timeout
      const users = snapshot.docs.map(doc => doc.data());
      
      for (let i = 0; i < users.length; i += batchSize) {
        // Check time limit
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          console.log(`Stopping due to time limit. Processed ${emailsSent}/${users.length} emails`);
          break;
        }

        const batch = users.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} users`);

        // Process batch - send to each user's actual email
        for (const userData of batch) {
          try {
            const emailContent = buildEmailContent(userData, config);
            
            await mg.messages.create('researchrewind.xyz', {
              from: `"${config.fromName}" <amulya@researchrewind.xyz>`,
              to: [userData.email],
              subject: config.subject,
              html: emailContent,
            });
            
            console.log(`Email sent to ${userData.email}`);
            emailsSent++;
            
            // Small delay between individual emails
            await new Promise(resolve => setTimeout(resolve, 50));
            
          } catch (error: any) {
            console.error(`Error sending email to ${userData.email}:`, error);
            emailsFailed++;
            errors.push(`${userData.email}: ${error.message}`);
          }
        }

        // Delay between batches
        if (i + batchSize < users.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log = originalLog;

      return NextResponse.json({
        success: true,
        mode: 'send',
        subject: config.subject,
        totalUsers: users.length,
        emailsSent,
        emailsFailed,
        errors,
        message: `Successfully sent ${emailsSent} emails to all subscribed users`,
        executionTime: Date.now() - startTime,
        timeoutWarning: Date.now() - startTime > MAX_EXECUTION_TIME ? 'Execution stopped due to time limit' : null,
        logs
      });
    }

    // Should never reach here
    return NextResponse.json({
      success: false,
      error: 'Invalid mode or logic error'
    }, { status: 500 });

  } catch (error: any) {
    console.log = originalLog;
    return NextResponse.json({
      success: false,
      error: error.message,
      logs
    }, { status: 500 });
  }
}

function generateConfirmationCode(subject: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const subjectSnippet = subject.slice(0, 10).replace(/[^a-zA-Z0-9]/g, '');
  return `SEND-${date}-${subjectSnippet}`;
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