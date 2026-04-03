import * as React from 'react'; import { useState, useEffect } from 'react';

import { Box, Text } from 'ink';


export function Onboarding({  }: {  }) {
  const [step, setStep] = useState<any>(0);
  const [selectedEngines, setSelectedEngines] = useState<any>([]);
  const [defaultEngine, setDefaultEngine] = useState<any>(null);
  const [scanning, setScanning] = useState<any>(true);

  return null;
}


