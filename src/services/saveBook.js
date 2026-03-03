import { db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";

// writes to: Users/{uid}/Books/{bookSlug}
export async function saveBookForUser({ uid, bookId, data }) {
  const ref = doc(db, "Users", uid, "Books", bookId);
  await setDoc(ref, data, { merge: true });
}