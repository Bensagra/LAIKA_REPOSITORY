import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBPNhmnzZWAjL6RGOVR-bqEMyVrKJ9TBgM",
  authDomain: "laikarescuedog.firebaseapp.com",
  projectId: "laikarescuedog",
  storageBucket: "laikarescuedog.firebasestorage.app",
  messagingSenderId: "1031859141654",
  appId: "1:1031859141654:web:6d3838326763a95da04937",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);