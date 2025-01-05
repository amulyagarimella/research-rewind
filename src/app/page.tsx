'use client'

import React from 'react';
import domains from './domains.json';
import Form from './form';


// Subject hierarchy
const subjects = domains["results"];

const intervals = [1, 5, 10, 50, 100];

export default function App() {
  return (
    <div>
      <div className="flex flex-col items-center">
        <h1>Vintage Nature</h1>
        <p>Receive daily emails with the top Nature papers from the past.</p>
      
        <h2>Sign up</h2>
        <Form subjects={subjects} intervals={intervals}/>
      </div>
    </div>
  );
}

