// @kern-source: onboarding:1
import { useState, useEffect } from 'react';

// @kern-source: onboarding:2
import { Box, Text } from 'ink';

// @kern-source: onboarding:4

export function Onboarding({  }: {  }) {
  const [step, setStep] = useState<any>(0);
  const [selectedEngines, setSelectedEngines] = useState<any>([]);
  const [defaultEngine, setDefaultEngine] = useState<any>(null);
  const [scanning, setScanning] = useState<any>(true);

  return null;
}


