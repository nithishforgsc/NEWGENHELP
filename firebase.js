import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Make sure these match your actual Firebase Project Settings
const firebaseConfig = {
  apiKey: "INSERT_YOUR_FIREBASE_API_KEY_HERE",
  authDomain: "newgenhelp-0102.firebaseapp.com",
  databaseURL: "https://newgenhelp-0102-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "newgenhelp-0102",
  storageBucket: "newgenhelp-0102.firebasestorage.app",
  messagingSenderId: "97212954272",
  appId: "1:97212954272:web:d27497ee2961ca4b4cbbc5",
  measurementId: "G-5JJ9C0KV2X"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db };