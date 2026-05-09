export type CharacterName = 'rashu' | 'tanya' | 'simmu';

export interface Character {
  name: CharacterName;
  displayName: string;
  color: string;
  secondaryColor: string;
  avatarSeed: string;
  hairColor: string;
  skinColor: string;
}

export const CHARACTERS: Record<CharacterName, Character> = {
  rashu: {
    name: 'rashu',
    displayName: 'Rashu',
    color: '#f472b6',
    secondaryColor: '#fce7f3',
    avatarSeed: 'rashu-beautiful',
    hairColor: 'black',
    skinColor: 'light',
  },
  tanya: {
    name: 'tanya',
    displayName: 'Tanya',
    color: '#818cf8',
    secondaryColor: '#ede9fe',
    avatarSeed: 'tanya-gorgeous',
    hairColor: 'brown',
    skinColor: 'medium',
  },
  simmu: {
    name: 'simmu',
    displayName: 'Simmu',
    color: '#34d399',
    secondaryColor: '#d1fae5',
    avatarSeed: 'simmu-lovely',
    hairColor: 'darkBrown',
    skinColor: 'dark',
  },
};

// Map each game route to a character
export const GAME_CHARACTERS: Record<string, CharacterName> = {
  '4-in-a-row': 'rashu',
  'word-puzzle': 'tanya',
  'dots-and-boxes': 'simmu',
};

// Guide steps per game
export const GAME_GUIDES: Record<string, string[]> = {
  '4-in-a-row': [
    "Welcome to 4 in a Row! 🔴 Drop your colored disc into any column.",
    "Connect FOUR of your discs in a row — horizontally, vertically, or diagonally!",
    "Plan ahead! Block your opponent's moves while building your own sequence.",
    "In multiplayer, connect SIX in a row. First to do it earns the top rank! 🏆",
  ],
  'word-puzzle': [
    "Welcome to Word Search! 📝 Hidden words are scattered across the board.",
    "Click a letter and drag to highlight a word — any direction works!",
    "Longer words score more points. Find them before your opponents!",
    "Race against the clock and your rivals. Most points wins! 🥇",
  ],
  'dots-and-boxes': [
    "Welcome to Dots & Boxes! ⬜ Draw lines between dots to claim boxes.",
    "Complete all 4 sides of a box to capture it — and take another turn!",
    "Strategy tip: avoid giving your opponent a chain of open boxes!",
    "The player with the most boxes at the end wins the game! 🏆",
  ],
};
