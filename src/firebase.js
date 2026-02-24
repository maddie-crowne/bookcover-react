import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyA4-XTWbrgGNWy-QdiKmtevLnnUcZLNs2Y",
  authDomain: "bookcover-muc-26.firebaseapp.com",
  projectId: "bookcover-muc-26",
  storageBucket: "bookcover-muc-26.firebasestorage.app",
  messagingSenderId: "819536969150",
  appId: "1:819536969150:web:32cc144b09aad2c95d4def",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);