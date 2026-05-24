export const parseStudentNumbers = (format: string | undefined, fallbackStart: number, fallbackEnd: number, absent: number[]): number[] => {
  const result = new Set<number>();
  
  if (format === undefined || format.trim() === '') {
    // Fallback to startNumber and endNumber
    for (let i = fallbackStart; i <= fallbackEnd; i++) {
      result.add(i);
    }
  } else {
    const parts = format.split(',').map(p => p.trim());
    for (const part of parts) {
      if (!part) continue;
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            result.add(i);
          }
        }
      } else {
        const num = parseInt(part, 10);
        if (!isNaN(num)) result.add(num);
      }
    }
  }
  
  const arr = Array.from(result).sort((a, b) => a - b);
  return arr.filter(n => !absent.includes(n));
};
