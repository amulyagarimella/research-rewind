import { dbAdmin } from "../../../lib/firebaseAdmin";
import crypto from 'crypto';

export async function POST(request:Request) {
    const url = new URL(request.url);
    const email = url.searchParams.get('email');
    const token = url.searchParams.get('token');

    // Verify the token
    const secret = process.env.UNSUBSCRIBE_SECRET;
    const expectedToken = crypto.createHash('sha256').update(`${email}${secret}`).digest('hex');

    if (token !== expectedToken) {
        return new Response(JSON.stringify({ success: false }), { status: 400 });
    }

    try {
        // Update user's subscription status in Firestore
        const q = dbAdmin.collection('users').where("email", "==", email).limit(1);
        const querySnapshot = await q.get(); 
        if (!querySnapshot.empty) {
            await querySnapshot.docs[0].ref.delete();
            // Update existing document
            /*querySnapshot.forEach(async (docSnapshot) => {
                await dbAdmin.collection("users").doc(docSnapshot.id).update({
                    subscribed: false,
                }); 
            });*/
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        } else {
            return new Response(JSON.stringify({ success: false }), { status: 404 });
        }
    } catch (error) {
        console.error('Error unsubscribing:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
}