import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";

// Reads from: Users/{uid}/Books/*
export async function fetchBooksForUser(uid) {
  const colRef = collection(db, "Users", uid, "Books");
  const snap = await getDocs(colRef);

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
}