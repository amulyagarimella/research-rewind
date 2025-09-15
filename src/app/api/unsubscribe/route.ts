import { dbAdmin } from "../../../lib/firebaseAdmin";
// import crypto from 'crypto';

export async function GET(request:Request) {
    const url = new URL(request.url);
    const email = url.searchParams.get('email');

   if (!email) {
        return new Response(JSON.stringify({ success: false,error: 'Email is required in the URL, e.g. /api/unsubscribe?email=test@test.com'  }), { status: 400});
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
            console.log(`Email ${email} not found in our database; you are already unsubscribed.`);
            return new Response(JSON.stringify({ success: true,error: 'You are unsubscribed.'  }), { status: 200});
        }
    } catch (error) {
        console.error('Error unsubscribing:', error);
        return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
}