import {useState} from 'react';

type History<T> = {past: T[]; present: T; future: T[]};

export function useHistory<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({past: [], present: initial, future: []});
  const commit = (change: (value: T) => T) => setHistory((state) => {
    const next = change(state.present);
    return next === state.present ? state : {
      past: [...state.past.slice(-99), state.present], present: next, future: [],
    };
  });
  const undo = () => setHistory((state) => {
    const previous = state.past[state.past.length - 1];
    return previous === undefined ? state : {
      past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future],
    };
  });
  const redo = () => setHistory((state) => {
    const next = state.future[0];
    return next === undefined ? state : {
      past: [...state.past.slice(-99), state.present], present: next, future: state.future.slice(1),
    };
  });
  const reset = (value: T) => setHistory({past: [], present: value, future: []});
  return {value: history.present, commit, undo, redo, reset,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0};
}
