/**
 * Game Modes, Fictional Teams, Match Rules, Scorecard & Wagon Wheel State (modes.js)
 * Supports One Day (50 overs + 10/20/30 options), T20 (20 overs), T5 (5 overs),
 * 10 wickets, Wides, No-Balls with Free Hit, LBW, Caught-Behind, Coin Toss, and Super Over.
 */

export const FICTIONAL_TEAMS = [
  {
    id: 'mumbai_meteors',
    nameEn: 'Metro Meteors',
    nameHi: 'मेट्रो उल्का (Meteors)',
    short: 'MET',
    primaryColor: '#0284c7',
    secondaryColor: '#f59e0b',
    defaultNumber: 18,
    roster: [
      'Aarav Varma', 'Rohan Deshmukh', 'Kabir Khanna', 'Vikramajeet Singh',
      'Devansh Joshi', 'Karanveer Nair', 'Samarth Kulkarni', 'Yashwardhan Rao',
      'Pranav Chatterjee', 'Harshvardhan Patel', 'Zeeshan Qureshi'
    ]
  },
  {
    id: 'deccan_dynamos',
    nameEn: 'Deccan Dynamos',
    nameHi: 'डेक्कन डायनेमोज़',
    short: 'DEC',
    primaryColor: '#ea580c',
    secondaryColor: '#0f172a',
    defaultNumber: 7,
    roster: [
      'Reyansh Reddy', 'Aditya Malhotra', 'Siddharth Menon', 'Nikhil Subramanian',
      'Tarun Shekhawat', 'Arjun Rathore', 'Mayank Tiwari', 'Deepak Choudhary',
      'Varun Goswami', 'Rishabh Bansal', 'Kartikeya Iyer'
    ]
  },
  {
    id: 'northern_knights',
    nameEn: 'Capital Strikers',
    nameHi: 'कैपिटल स्ट्राइकर्स',
    short: 'CAP',
    primaryColor: '#dc2626',
    secondaryColor: '#1e3a8a',
    defaultNumber: 45,
    roster: [
      'Vivaan Kapoor', 'Shaurya Gill', 'Ishaan Bedi', 'Anirudh Sharma',
      'Lakshya Chauhan', 'Rajवीर Sehgal', 'Gaurav Thakur', 'Manish Grover',
      'Abhishek Pandey', 'Tushar Bakshi', 'Chetan Solanki'
    ]
  },
  {
    id: 'coastal_titans',
    nameEn: 'Coastal Titans',
    nameHi: 'कोस्टल टाइटन्स',
    short: 'COA',
    primaryColor: '#059669',
    secondaryColor: '#facc15',
    defaultNumber: 33,
    roster: [
      'Atharv Hegde', 'Darshan Kamath', 'Chirag Shetty', 'Hrithik Pai',
      'Naveen Gowda', 'Surya Prakash', 'Kunal Nambiar', 'Ashwin Kurup',
      'PrithviPillai', 'Shreyas Shenoy', 'Umesh Bhandari'
    ]
  },
  {
    id: 'royal_falcons',
    nameEn: 'Desert Falcons',
    nameHi: 'डेज़र्ट फाल्कन्स',
    short: 'FAL',
    primaryColor: '#7c3aed',
    secondaryColor: '#f43f5e',
    defaultNumber: 99,
    roster: [
      'Rudra Pratap', 'Yuvraj Sisodia', 'Karan Chauhan', 'Bhavesh Mewada',
      'Himanshu Gehlot', 'Jatin Rathod', 'LokeshPaliwal', 'Mohit Soni',
      'Nitin Vyas', 'Pankaj Doshi', 'Rahul Bishnoi'
    ]
  },
  {
    id: 'eastern_thunder',
    nameEn: 'Bay Thunderbolts',
    nameHi: 'बे थंडरबोल्ट्स',
    short: 'THU',
    primaryColor: '#eab308',
    secondaryColor: '#1e1b4b',
    defaultNumber: 10,
    roster: [
      'Soham Mukherjee', 'Aritra Sen', 'Debanjan Bose', 'Subham Ganguly',
      'Soumya Roy', 'Aniket Dutta', 'Ritam Sengupta', 'Koushik Mitra',
      'Sayan Ghosh', 'Tamoghna Das', 'Bishal Mondal'
    ]
  }
];

export const GAME_MODES = {
  t5: {
    id: 't5',
    nameEn: 'T5 Blitz (5 Overs)',
    nameHi: 'T5 ब्लिट्ज़ (5 ओवर)',
    defaultOvers: 5,
    overOptions: [5],
    getBowlerMax: () => 1,
    getPowerplayOvers: () => 1
  },
  t20: {
    id: 't20',
    nameEn: 'T20 Arcade (20 Overs)',
    nameHi: 'T20 आर्केड (20 ओवर)',
    defaultOvers: 20,
    overOptions: [20],
    getBowlerMax: () => 4,
    getPowerplayOvers: () => 6
  },
  oneday: {
    id: 'oneday',
    nameEn: 'One Day (10/20/30/50 Overs)',
    nameHi: 'वन डे (10/20/30/50 ओवर)',
    defaultOvers: 50,
    overOptions: [10, 20, 30, 50],
    getBowlerMax: (overs) => Math.max(1, Math.floor(overs / 5)),
    getPowerplayOvers: (overs) => (overs === 50 ? 10 : Math.max(2, Math.floor(overs / 5)))
  }
};

export class MatchEngine {
  constructor() {
    this.modeId = 't5';
    this.totalOvers = 5;
    this.bowlerMaxOvers = 1;
    this.powerplayOvers = 1;

    this.matchType = 'ai';       // 'ai' | 'local1v1' | 'online1v1'
    this.difficulty = 'pro';     // 'easy' | 'pro' | 'legend'
    this.stadium = 'night';      // 'street' | 'club' | 'night'

    // Team customization
    this.teamA = structuredClone(FICTIONAL_TEAMS[0]);
    this.teamB = structuredClone(FICTIONAL_TEAMS[1]);

    // Toss state
    this.tossWinner = 'teamA';
    this.tossDecision = 'bat';   // 'bat' | 'bowl'
    this.userRole = 'bat';       // 'bat' | 'bowl' in current innings

    // Match progress
    this.innings = 1;            // 1 | 2
    this.isSuperOver = false;
    this.isMatchOver = false;
    this.winnerTextEn = '';
    this.winnerTextHi = '';

    this.resetInningsState();
  }

  configureMatch({
    modeId = 't5',
    overs = 5,
    matchType = 'ai',
    difficulty = 'pro',
    stadium = 'night',
    teamAIndex = 0,
    teamBIndex = 1,
    jerseyColorA = null,
    jerseyNumberA = 18,
    userBattedFirst = true
  }) {
    const mode = GAME_MODES[modeId] || GAME_MODES.t5;
    this.modeId = mode.id;
    this.totalOvers = overs || mode.defaultOvers;
    this.bowlerMaxOvers = mode.getBowlerMax(this.totalOvers);
    this.powerplayOvers = mode.getPowerplayOvers(this.totalOvers);

    this.matchType = matchType;
    this.difficulty = difficulty;
    this.stadium = stadium;

    this.teamA = structuredClone(FICTIONAL_TEAMS[teamAIndex % FICTIONAL_TEAMS.length]);
    this.teamB = structuredClone(FICTIONAL_TEAMS[teamBIndex % FICTIONAL_TEAMS.length]);
    if (jerseyColorA) this.teamA.primaryColor = jerseyColorA;
    if (jerseyNumberA) this.teamA.defaultNumber = Number(jerseyNumberA) || 18;

    this.innings = 1;
    this.isSuperOver = false;
    this.isMatchOver = false;
    this.userRole = userBattedFirst ? 'bat' : 'bowl';
    this.firstInningsScore = null;
    this.resetInningsState();
  }

  resetInningsState() {
    const battingTeam = (this.innings === 1 && this.userRole === 'bat') || (this.innings === 2 && this.userRole === 'bat')
      ? this.teamA
      : this.teamB;
    const bowlingTeam = battingTeam === this.teamA ? this.teamB : this.teamA;

    this.battingTeam = battingTeam;
    this.bowlingTeam = bowlingTeam;

    this.runs = 0;
    this.wickets = 0;
    this.maxWickets = this.isSuperOver ? 2 : 10;
    this.legalBalls = 0;
    this.extras = { wides: 0, noBalls: 0, total: 0 };
    this.freeHit = false;

    this.strikerIndex = 0;
    this.nonStrikerIndex = 1;
    this.currentBowlerIndex = 6; // Bowlers from index 6..10

    // Scorecard rows for all 11 batters
    this.battingCard = battingTeam.roster.map((name, idx) => ({
      index: idx,
      name,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      statusEn: idx <= 1 ? 'Not Out' : 'Yet to Bat',
      statusHi: idx <= 1 ? 'नाबाद' : 'बल्लेबाजी बाकी',
      isOut: false
    }));

    // Bowling figures for 5 frontline bowlers
    this.bowlingCard = bowlingTeam.roster.slice(6, 11).map((name, idx) => ({
      rosterIndex: idx + 6,
      name,
      balls: 0,
      runs: 0,
      wickets: 0
    }));

    // Current over ball-by-ball badges ('0', '1', '2', '4', '6', 'W', 'WD', 'NB')
    this.currentOverBalls = [];
    // Wagon wheel shots [{ angleRad, distance, runs, batsmanName }]
    this.wagonWheel = [];
  }

  startSuperOver() {
    this.isSuperOver = true;
    this.totalOvers = 1;
    this.bowlerMaxOvers = 1;
    this.powerplayOvers = 0;
    this.innings = 1;
    this.isMatchOver = false;
    this.firstInningsScore = null;
    this.resetInningsState();
  }

  getOversFormatted(legalBalls = this.legalBalls) {
    const o = Math.floor(legalBalls / 6);
    const b = legalBalls % 6;
    return `${o}.${b}`;
  }

  getCurrentRunRate() {
    if (this.legalBalls === 0) return '0.00';
    return ((this.runs / this.legalBalls) * 6).toFixed(2);
  }

  getRequiredRunRate() {
    if (this.innings !== 2 || this.firstInningsScore === null) return null;
    const target = this.firstInningsScore + 1;
    const runsNeeded = Math.max(0, target - this.runs);
    const ballsRemaining = Math.max(1, this.totalOvers * 6 - this.legalBalls);
    return ((runsNeeded / ballsRemaining) * 6).toFixed(2);
  }

  isPowerplayActive() {
    const currentOver = Math.floor(this.legalBalls / 6);
    return currentOver < this.powerplayOvers;
  }

  getActiveStriker() {
    return this.battingCard[this.strikerIndex];
  }

  getActiveNonStriker() {
    return this.battingCard[this.nonStrikerIndex];
  }

  getActiveBowler() {
    const idx = this.currentBowlerIndex - 6;
    return this.bowlingCard[Math.max(0, Math.min(this.bowlingCard.length - 1, idx))];
  }

  /**
   * Records outcome of a delivery and updates scorecard, strike rotation, overs, and innings
   */
  recordDeliveryOutcome({
    runsScored = 0,
    isBoundary = false,
    isWide = false,
    isNoBall = false,
    isWicket = false,
    wicketTypeEn = 'Bowled',
    wicketTypeHi = 'बोल्ड',
    shotAngleRad = 0,
    shotDistance = 0
  }) {
    const striker = this.getActiveStriker();
    const bowler = this.getActiveBowler();

    // Free Hit rule: Batsman can only be dismissed Run Out on a Free Hit!
    if (this.freeHit && isWicket && wicketTypeEn !== 'Run Out') {
      isWicket = false;
    }

    if (isWide) {
      this.runs += 1 + runsScored;
      this.extras.wides += 1 + runsScored;
      this.extras.total += 1 + runsScored;
      bowler.runs += 1 + runsScored;
      this.currentOverBalls.push(runsScored > 0 ? `WD+${runsScored}` : 'WD');
      // Wide does not count as a legal ball and keeps Free Hit if active
      this.checkInningsEnd();
      return { freeHitNext: this.freeHit, overCompleted: false };
    }

    if (isNoBall) {
      this.runs += 1 + runsScored;
      this.extras.noBalls += 1;
      this.extras.total += 1;
      striker.runs += runsScored;
      striker.balls += 1;
      if (runsScored === 4 && isBoundary) striker.fours++;
      if (runsScored === 6 && isBoundary) striker.sixes++;
      bowler.runs += 1 + runsScored;
      this.freeHit = true; // Next delivery is a FREE HIT!
      this.currentOverBalls.push(runsScored > 0 ? `NB+${runsScored}` : 'NB');
      if (runsScored % 2 === 1) this.swapStrike();
      this.checkInningsEnd();
      return { freeHitNext: true, overCompleted: false };
    }

    // Legal delivery
    this.legalBalls++;
    bowler.balls++;
    striker.balls++;
    this.freeHit = false;

    if (isWicket) {
      this.wickets++;
      if (wicketTypeEn !== 'Run Out') bowler.wickets++;
      striker.isOut = true;
      striker.statusEn = `${wicketTypeEn} b ${bowler.name.split(' ')[1] || bowler.name}`;
      striker.statusHi = `${wicketTypeHi} (${bowler.name.split(' ')[0]})`;
      this.currentOverBalls.push('W');

      // Bring in next batter
      const nextBatterIdx = Math.max(this.strikerIndex, this.nonStrikerIndex) + 1;
      if (nextBatterIdx < 11 && this.wickets < this.maxWickets) {
        this.strikerIndex = nextBatterIdx;
        this.battingCard[this.strikerIndex].statusEn = 'Not Out';
        this.battingCard[this.strikerIndex].statusHi = 'नाबाद';
      }
    } else {
      this.runs += runsScored;
      striker.runs += runsScored;
      bowler.runs += runsScored;
      if (runsScored === 4 && isBoundary) striker.fours++;
      if (runsScored === 6 && isBoundary) striker.sixes++;
      this.currentOverBalls.push(String(runsScored));

      if (runsScored > 0 && shotDistance > 2) {
        this.wagonWheel.push({
          angleRad: shotAngleRad,
          distance: shotDistance,
          runs: runsScored,
          batsmanName: striker.name
        });
      }

      if (runsScored % 2 === 1) {
        this.swapStrike();
      }
    }

    // Check End of Over (every 6 legal balls)
    let overCompleted = false;
    if (this.legalBalls > 0 && this.legalBalls % 6 === 0) {
      overCompleted = true;
      this.swapStrike();
      this.currentOverBalls = [];
      this.rotateBowler();
    }

    this.checkInningsEnd();
    return { freeHitNext: this.freeHit, overCompleted };
  }

  swapStrike() {
    const tmp = this.strikerIndex;
    this.strikerIndex = this.nonStrikerIndex;
    this.nonStrikerIndex = tmp;
  }

  rotateBowler() {
    // Select next bowler who hasn't exceeded bowlerMaxOvers
    for (let offset = 1; offset <= 5; offset++) {
      const candidateRosterIdx = 6 + ((this.currentBowlerIndex - 6 + offset) % 5);
      const cardEntry = this.bowlingCard.find((b) => b.rosterIndex === candidateRosterIdx);
      if (cardEntry && Math.floor(cardEntry.balls / 6) < this.bowlerMaxOvers) {
        this.currentBowlerIndex = candidateRosterIdx;
        return;
      }
    }
  }

  checkInningsEnd() {
    const maxBalls = this.totalOvers * 6;
    const allOut = this.wickets >= this.maxWickets;
    const oversDone = this.legalBalls >= maxBalls;

    if (this.innings === 1) {
      if (allOut || oversDone) {
        this.firstInningsScore = this.runs;
        this.firstInningsWickets = this.wickets;
        this.firstInningsOvers = this.getOversFormatted();
        this.firstInningsCard = structuredClone(this.battingCard);
        this.firstInningsWagon = structuredClone(this.wagonWheel);
        // Switch innings & role
        this.innings = 2;
        this.userRole = this.userRole === 'bat' ? 'bowl' : 'bat';
        this.resetInningsState();
        return 'innings_break';
      }
    } else if (this.innings === 2) {
      const target = (this.firstInningsScore || 0) + 1;
      if (this.runs >= target) {
        this.isMatchOver = true;
        const wicketsLeft = this.maxWickets - this.wickets;
        this.winnerTextEn = `${this.battingTeam.nameEn} won by ${wicketsLeft} wickets!`;
        this.winnerTextHi = `${this.battingTeam.nameHi} ${wicketsLeft} विकेट से जीता!`;
        return 'match_over';
      }
      if (allOut || oversDone) {
        if (this.runs === this.firstInningsScore) {
          // Tie! Trigger Super Over!
          this.winnerTextEn = 'MATCH TIED! ENTERING SUPER OVER!';
          this.winnerTextHi = 'मैच टाई! सुपर ओवर शुरू!';
          return 'super_over';
        }
        this.isMatchOver = true;
        const margin = this.firstInningsScore - this.runs;
        this.winnerTextEn = `${this.bowlingTeam.nameEn} won by ${margin} runs!`;
        this.winnerTextHi = `${this.bowlingTeam.nameHi} ${margin} रन से जीता!`;
        return 'match_over';
      }
    }
    return null;
  }
}
