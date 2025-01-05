import { dbAdmin } from "../../../lib/firebaseAdmin";

export async function POST(request: Request) {
    try {
        console.log("DEBUG - request: ", request);
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
                    subscribed: true,
                    subjects: userSubjects,
                    intervals: userIntervals,
                }); 
            });
        } else {
            // Create new document
            await dbAdmin.collection("users").doc().set({
                name: name,
                subscribed: true,
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