import { dbAdmin } from "../../../lib/firebaseAdmin";
import crypto from 'crypto';

function generateUnsubscribeToken(email:string) {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    return crypto.createHash('sha256').update(`${email}${secret}`).digest('hex');
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, email, subscribed, userIntervals, userSubjects } = body;
        if (!name || !email || !subscribed || !userIntervals || !userSubjects) {
            return new Response(JSON.stringify({ success: false }), { status: 400 });
        }
        const emailLowerCase = email.toLowerCase();
        const q = dbAdmin.collection("users").where("email", "==", emailLowerCase).limit(1);
        const querySnapshot = await q.get();

        if (!querySnapshot.empty) {
            // Update existing document
            querySnapshot.forEach(async (docSnapshot) => {
                await dbAdmin.collection("users").doc(docSnapshot.id).update({
                    name: name,
                    subjects: userSubjects,
                    intervals: userIntervals,
                }); 
            });
        } else {
            // Create new document
            await dbAdmin.collection("users").doc().set({
                name: name,
                email: emailLowerCase,
                subjects: userSubjects,
                intervals: userIntervals,
            });
        }
        return new Response(JSON.stringify({ success: true }), { status: 201 });
    } catch (error) {
        console.log(error);
        return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
}