import { dbAdmin } from "../../../lib/firebaseAdmin";

export async function POST(request: Request) {
    let newAcc = false;
    try {
        const body = await request.json()
        const { name, email, subscribed, userIntervals, userSubjects, timezone } = body;
        if (!name || !email || !subscribed || !userIntervals || !userSubjects  || !timezone || userIntervals.length === 0 || userSubjects.length === 0) {
            return new Response(JSON.stringify({ success: false }), { status: 400 });
        }
        const emailLowerCase = email.toLowerCase();
        const subjectIds = userSubjects.map((s:string) => {
            if (s.includes('field')) { 
                s.replace(/\D/g, '') 
            }
        });
        const q = dbAdmin.collection("users").where("email", "==", emailLowerCase).limit(1);
        const querySnapshot = await q.get();

        if (!querySnapshot.empty) {
            // Update existing document
            querySnapshot.forEach(async (docSnapshot) => {
                await dbAdmin.collection("users").doc(docSnapshot.id).update({
                    name: name,
                    subscribed: true,
                    subjects: subjectIds,
                    intervals: userIntervals,
                    timezone: timezone,
                }); 
            });
        } else {
            // Create new document
            await dbAdmin.collection("users").doc().set({
                name: name,
                subscribed: true,
                email: emailLowerCase,
                subjects: subjectIds,
                intervals: userIntervals,
                timezone: timezone,
            });
            newAcc = true;
        }
        return new Response(JSON.stringify({ 
            success: true, 
            payload: {
                newAcc: newAcc,
            }, 
        }), { status: 201 });
    } catch (error) {
        console.log(error);
        return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
}