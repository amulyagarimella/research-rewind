'use client'

import React from 'react';
import domains from './domains.json';
import Form from './form';


// Subject hierarchy
const subjects = domains["results"];

const intervals = [1, 5, 10, 50, 100];

console.log(process.env.NEXT_PUBLIC_BASE_URL);

export default function App() {
  return (
    <div>
      <div className="flex flex-col items-center">
        <h1>Research Rewind</h1>
        <p>Receive daily emails with the top Nature papers from decades past.</p>
      
        <h2>Sign up</h2>
        <Form subjects={subjects} intervals={intervals}/>
      </div>
    </div>
  );
}

