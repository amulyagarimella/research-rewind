/*import { getFirestore, collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./firebase"

async function unsubscribe(email) {
  try {
    const q = query(collection(db, "users"), where("email", "==", email));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error("No user found with this email.");
    }

    const userDoc = querySnapshot.docs[0];
    await updateDoc(userDoc.ref, { subscribed: false });

    alert("You have been unsubscribed.");
  } catch (error) {
    console.error("Error unsubscribing:", error);
    alert("Failed to unsubscribe.");
  }
}

// Parse email from query parameter and unsubscribe
const urlParams = new URLSearchParams(window.location.search);
const email = urlParams.get("email");
if (email) {
  unsubscribe(email);
}
*/