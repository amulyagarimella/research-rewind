import { dbAdmin } from "../../../lib/firebaseAdmin";

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { name, email, subscribed, userIntervals, userSubjects } = body;
        if (!name || !email || !subscribed || !userIntervals || !userSubjects) {
            return new Response(JSON.stringify({ success: false }), { status: 400 });
        }
        const emailLowerCase = email.toLowerCase();
        const q = dbAdmin.collection("users").where("email", "==", emailLowerCase);
        const querySnapshot = await q.get();

        if (!querySnapshot.empty) {
            // Update existing document
            querySnapshot.forEach(async (docSnapshot) => {
                
                await dbAdmin.collection("users").doc(docSnapshot.id).update({
                    name: name,
                    subscribed: subscribed,
                    subjects: userSubjects,
                    intervals: userIntervals,
                }); // Use dbAdmin
            });
        } else {
            // Create new document
            await dbAdmin.collection("users").doc().set({
                name: name,
                email: emailLowerCase,
                subscribed: subscribed,
                subjects: userSubjects,
                intervals: userIntervals,
            });
        }

        return new Response(JSON.stringify({ success: true }), { status: 201 });
    } catch (error) {
        return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
}