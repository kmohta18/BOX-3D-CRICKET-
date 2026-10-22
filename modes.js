import {
  normalizeDifficultyKey,
  getDifficultyProfile,
  rollRunChaseTarget,
  gameConfig,
  saveGameConfig
} from './config.js';

/**
 * Game Modes, Top 9 World Cricket Teams, 3 Iconic Indian Stadiums, Match Rules,
 * Scorecard & Wagon Wheel State (modes.js)
 * Modes:
 *  1) Run Chase (5 Overs · User Bats Only · Random Target by Difficulty: Easy 20-30, Medium 40-60, Hard 61-100)
 *  2) T20 Match (20 Overs · Real Cricket Coin Toss + Full Match)
 */

export const INDIAN_STADIUMS = [
  {
    id: 'eden_gardens',
    nameEn: 'Eden Gardens, Kolkata',
    nameHi: 'ईडन गार्डन्स, कोलकाता',
    shortEn: 'Eden Gardens',
    city: 'Kolkata'
  },
  {
    id: 'wankhede',
    nameEn: 'Wankhede Stadium, Mumbai',
    nameHi: 'वानखेड़े स्टेडियम, मुंबई',
    shortEn: 'Wankhede',
    city: 'Mumbai'
  },
  {
    id: 'narendra_modi',
    nameEn: 'Narendra Modi Stadium, Ahmedabad',
    nameHi: 'नरेंद्र मोदी स्टेडियम, अहमदाबाद',
    shortEn: 'Narendra Modi',
    city: 'Ahmedabad'
  }
];

export const FICTIONAL_TEAMS = [
  {
    id: 'india',
    nameEn: 'India',
    nameHi: 'भारत (India)',
    short: 'IND',
    primaryColor: '#0284c7',
    secondaryColor: '#f97316',
    defaultNumber: 18,
    roster: [
      'Rohit Sharma', 'Yashasvi Jaiswal', 'Virat Kohli', 'Suryakumar Yadav',
      'Rishabh Pant', 'Hardik Pandya', 'Ravindra Jadeja', 'Axar Patel',
      'Kuldeep Yadav', 'Jasprit Bumrah', 'Arshdeep Singh'
    ]
  },
  {
    id: 'australia',
    nameEn: 'Australia',
    nameHi: 'ऑस्ट्रेलिया (Australia)',
    short: 'AUS',
    primaryColor: '#eab308',
    secondaryColor: '#15803d',
    defaultNumber: 31,
    roster: [
      'Travis Head', 'David Warner', 'Mitchell Marsh', 'Glenn Maxwell',
      'Marcus Stoinis', 'Tim David', 'Matthew Wade', 'Pat Cummins',
      'Mitchell Starc', 'Adam Zampa', 'Josh Hazlewood'
    ]
  },
  {
    id: 'england',
    nameEn: 'England',
    nameHi: 'इंग्लैंड (England)',
    short: 'ENG',
    primaryColor: '#dc2626',
    secondaryColor: '#1e3a8a',
    defaultNumber: 63,
    roster: [
      'Jos Buttler', 'Phil Salt', 'Will Jacks', 'Jonny Bairstow',
      'Harry Brook', 'Moeen Ali', 'Liam Livingstone', 'Sam Curran',
      'Jofra Archer', 'Adil Rashid', 'Mark Wood'
    ]
  },
  {
    id: 'south_africa',
    nameEn: 'South Africa',
    nameHi: 'दक्षिण अफ्रीका (South Africa)',
    short: 'RSA',
    primaryColor: '#16a34a',
    secondaryColor: '#facc15',
    defaultNumber: 45,
    roster: [
      'Quinton de Kock', 'Reeza Hendricks', 'Aiden Markram', 'Heinrich Klaasen',
      'David Miller', 'Tristan Stubbs', 'Marco Jansen', 'Keshav Maharaj',
      'Kagiso Rabada', 'Anrich Nortje', 'Tabraiz Shamsi'
    ]
  },
  {
    id: 'new_zealand',
    nameEn: 'New Zealand',
    nameHi: 'न्यूज़ीलैंड (New Zealand)',
    short: 'NZ',
    primaryColor: '#1e293b',
    secondaryColor: '#38bdf8',
    defaultNumber: 22,
    roster: [
      'Finn Allen', 'Devon Conway', 'Kane Williamson', 'Daryl Mitchell',
      'Glenn Phillips', 'Mark Chapman', 'Mitchell Santner', 'Matt Henry',
      'Tim Southee', 'Lockie Ferguson', 'Trent Boult'
    ]
  },
  {
    id: 'pakistan',
    nameEn: 'Pakistan',
    nameHi: 'पाकिस्तान (Pakistan)',
    short: 'PAK',
    primaryColor: '#059669',
    secondaryColor: '#a3e635',
    defaultNumber: 56,
    roster: [
      'Babar Azam', 'Mohammad Rizwan', 'Fakhar Zaman', 'Usman Khan',
      'Shadab Khan', 'Iftikhar Ahmed', 'Imad Wasim', 'Shaheen Afridi',
      'Naseem Shah', 'Haris Rauf', 'Mohammad Amir'
    ]
  },
  {
    id: 'west_indies',
    nameEn: 'West Indies',
    nameHi: 'वेस्ट इंडीज़ (West Indies)',
    short: 'WI',
    primaryColor: '#881337',
    secondaryColor: '#facc15',
    defaultNumber: 29,
    roster: [
      'Brandon King', 'Johnson Charles', 'Nicholas Pooran', 'Rovman Powell',
      'Sherfane Rutherford', 'Andre Russell', 'Romario Shepherd', 'Roston Chase',
      'Akeal Hosein', 'Alzarri Joseph', 'Gudakesh Motie'
    ]
  },
  {
    id: 'sri_lanka',
    nameEn: 'Sri Lanka',
    nameHi: 'श्रीलंका (Sri Lanka)',
    short: 'SL',
    primaryColor: '#1d4ed8',
    secondaryColor: '#eab308',
    defaultNumber: 49,
    roster: [
      'Pathum Nissanka', 'Kusal Mendis', 'Kamindu Mendis', 'Charith Asalanka',
      'Angelo Mathews', 'Dasun Shanaka', 'Wanindu Hasaranga', 'Maheesh Theekshana',
      'Matheesha Pathirana', 'Nuwan Thushara', 'Dushmantha Chameera'
    ]
  },
  {
    id: 'afghanistan',
    nameEn: 'Afghanistan',
    nameHi: 'अफ़ग़ानिस्तान (Afghanistan)',
    short: 'AFG',
    primaryColor: '#2563eb',
    secondaryColor: '#ef4444',
    defaultNumber: 19,
    roster: [
      'Rahmanullah Gurbaz', 'Ibrahim Zadran', 'Gulbadin Naib', 'Azmatullah Omarzai',
      'Mohammad Nabi', 'Najibullah Zadran', 'Karim Janat', 'Rashid Khan',
      'Noor Ahmad', 'Naveen-ul-Haq', 'Fazalhaq Farooqi'
    ]
  }
];

export const GAME_MODES = {
  run_chase: {
    id: 'run_chase',
    nameEn: 'Run Chase (5 Overs)',
    nameHi: 'रन चेज़ (5 ओवर)',
    defaultOvers: 5,
    overOptions: [5],
    getBowlerMax: () => 1,
    getPowerplayOvers: () => 2
  },
  t20: {
    id: 't20',
    nameEn: 'T20 Match',
    nameHi: 'T20 मैच',
    defaultOvers: 20,
    overOptions: [2, 5, 10, 20],
    getBowlerMax: (overs = 20) => Math.max(1, Math.ceil(overs / 5)),
    getPowerplayOvers: (overs = 20) => Math.max(1, Math.round(overs * 0.3))
  }
};

export class MatchEngine {
  constructor() {
    this.modeId = gameConfig.modeId === 't20' ? 't20' : 'run_chase';
    this.totalOvers = this.modeId === 't20' ? 20 : 5;
    this.bowlerMaxOvers = this.modeId === 't20' ? 4 : 1;
    this.powerplayOvers = this.modeId === 't20' ? 6 : 2;

    this.matchType = 'ai'; // 'ai' | 'local1v1' | 'online1v1'
    this.difficulty = normalizeDifficultyKey(gameConfig.difficulty || 'medium'); // 'easy' | 'medium' | 'hard'
    this.stadium = gameConfig.stadium || 'eden_gardens'; // 'eden_gardens' | 'wankhede' | 'narendra_modi'
    this.timeOfDay = gameConfig.timeOfDay || 'night'; // 'day' | 'night'

    // Team customization (Defaults: India vs Australia)
    this.teamA = structuredClone(FICTIONAL_TEAMS[0]);
    this.teamB = structuredClone(FICTIONAL_TEAMS[1]);

    // Toss state
    this.tossWinner = 'teamA';
    this.tossDecision = 'bat'; // 'bat' | 'bowl'
    this.userRole = 'bat'; // 'bat' | 'bowl' in current innings

    // Match progress
    this.innings = this.modeId === 'run_chase' ? 2 : 1;
    this.targetRuns = null;
    this.firstInningsScore = null;
    this.isSuperOver = false;
    this.isMatchOver = false;
    this.winnerTextEn = '';
    this.winnerTextHi = '';

    this.configureMatch({
      modeId: this.modeId,
      difficulty: this.difficulty,
      stadium: this.stadium,
      timeOfDay: this.timeOfDay,
      teamAIndex: 0,
      teamBIndex: 1,
      userBattedFirst: true
    });
  }

  configureMatch({
    modeId = 'run_chase',
    overs = null,
    matchType = 'ai',
    difficulty = gameConfig.difficulty || 'medium',
    stadium = gameConfig.stadium || 'eden_gardens',
    timeOfDay = gameConfig.timeOfDay || 'night',
    teamAIndex = 0,
    teamBIndex = 1,
    jerseyColorA = null,
    jerseyNumberA = null,
    userBattedFirst = true,
    customTargetRuns = null
  }) {
    const normalizedMode = modeId === 't20' ? 't20' : 'run_chase';
    const mode = GAME_MODES[normalizedMode] || GAME_MODES.run_chase;
    this.modeId = mode.id;
    this.totalOvers = mode.id === 'run_chase' ? 5 : (overs || mode.defaultOvers);
    this.bowlerMaxOvers = mode.getBowlerMax(this.totalOvers);
    this.powerplayOvers = mode.getPowerplayOvers(this.totalOvers);

    this.matchType = matchType;
    this.difficulty = normalizeDifficultyKey(difficulty);
    this.stadium = ['eden_gardens', 'wankhede', 'narendra_modi'].includes(stadium) ? stadium : 'eden_gardens';
    this.timeOfDay = timeOfDay === 'day' ? 'day' : 'night';

    gameConfig.modeId = this.modeId;
    gameConfig.difficulty = this.difficulty;
    gameConfig.stadium = this.stadium;
    gameConfig.timeOfDay = this.timeOfDay;
    saveGameConfig();

    const safeIdxA = Math.max(0, teamAIndex) % FICTIONAL_TEAMS.length;
    let safeIdxB = Math.max(0, teamBIndex) % FICTIONAL_TEAMS.length;
    if (safeIdxB === safeIdxA) {
      safeIdxB = (safeIdxA + 1) % FICTIONAL_TEAMS.length;
    }

    this.teamA = structuredClone(FICTIONAL_TEAMS[safeIdxA]);
    this.teamB = structuredClone(FICTIONAL_TEAMS[safeIdxB]);
    if (jerseyColorA) this.teamA.primaryColor = jerseyColorA;
    if (jerseyNumberA) this.teamA.defaultNumber = Number(jerseyNumberA) || this.teamA.defaultNumber;

    this.isSuperOver = false;
    this.isMatchOver = false;

    if (this.modeId === 'run_chase') {
      // Run Chase Mode: 5 Overs, Opponent already batted first and set a random target inside the difficulty range!
      const profile = getDifficultyProfile(this.difficulty);
      let target = Number(customTargetRuns);
      if (!Number.isFinite(target) || target < profile.chaseTargetMin || target > profile.chaseTargetMax) {
        target = rollRunChaseTarget(this.difficulty);
      }
      this.targetRuns = target;
      this.firstInningsTeamNameEn = this.teamB.nameEn;
      this.firstInningsTeamNameHi = this.teamB.nameHi;
      this.firstInningsTeamShort = this.teamB.short;
      this.firstInningsScore = target - 1;
      this.firstInningsWickets = Math.min(8, Math.max(2, Math.floor((target - 12) / 13)));
      this.firstInningsOvers = '5.0';
      this.innings = 2;
      this.userRole = 'bat'; // User always bats to chase the target in Run Chase mode
    } else {
      // T20 Mode: Starts in Innings 1 according to the Coin Toss result
      this.targetRuns = null;
      this.firstInningsTeamNameEn = null;
      this.firstInningsTeamNameHi = null;
      this.firstInningsTeamShort = null;
      this.firstInningsScore = null;
      this.firstInningsWickets = 0;
      this.firstInningsOvers = '0.0';
      this.innings = 1;
      this.userRole = userBattedFirst ? 'bat' : 'bowl';
    }

    this.winnerTextEn = '';
    this.winnerTextHi = '';
    this.matchSummaryLine = '';
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
      wickets: 0,
      consecutiveWickets: 0
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
    this.targetRuns = null;
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
    if (this.isMatchOver) {
      return {
        freeHitNext: false,
        overCompleted: false,
        wicketFell: false,
        inningsEndState: 'match_over',
        freeHitDismissalPrevented: false,
        milestoneReached: null,
        hatTrickWicket: false,
        onHatTrickNext: false
      };
    }

    const striker = this.getActiveStriker();
    const bowler = this.getActiveBowler();

    const prevStrikerRuns = striker.runs;
    let freeHitDismissalPrevented = false;

    // Free Hit rule: Batsman can only be dismissed Run Out on a Free Hit!
    if (this.freeHit && isWicket && wicketTypeEn !== 'Run Out') {
      isWicket = false;
      freeHitDismissalPrevented = true;
    }

    if (isWide) {
      this.runs += 1 + runsScored;
      this.extras.wides += 1 + runsScored;
      this.extras.total += 1 + runsScored;
      bowler.runs += 1 + runsScored;
      this.currentOverBalls.push(runsScored > 0 ? `WD+${runsScored}` : 'WD');
      // Wide does not count as a legal ball and keeps Free Hit if active
      this.checkInningsEnd();
      return {
        freeHitNext: this.freeHit,
        overCompleted: false,
        freeHitDismissalPrevented,
        milestoneReached: null,
        hatTrickWicket: false,
        onHatTrickNext: (bowler.consecutiveWickets || 0) === 2
      };
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
      const milestoneReached =
        prevStrikerRuns < 100 && striker.runs >= 100
          ? 100
          : prevStrikerRuns < 50 && striker.runs >= 50
            ? 50
            : null;
      if (runsScored % 2 === 1) this.swapStrike();
      this.checkInningsEnd();
      return {
        freeHitNext: true,
        overCompleted: false,
        freeHitDismissalPrevented,
        milestoneReached,
        hatTrickWicket: false,
        onHatTrickNext: (bowler.consecutiveWickets || 0) === 2
      };
    }

    // Legal delivery
    this.legalBalls++;
    bowler.balls++;
    striker.balls++;
    this.freeHit = false;

    let milestoneReached = null;
    let hatTrickWicket = false;

    if (isWicket) {
      this.wickets++;
      if (wicketTypeEn !== 'Run Out') {
        bowler.wickets++;
        bowler.consecutiveWickets = (bowler.consecutiveWickets || 0) + 1;
        if (bowler.consecutiveWickets >= 3) {
          hatTrickWicket = true;
        }
      } else {
        bowler.consecutiveWickets = 0;
      }
      striker.isOut = true;
      const bowlerShort = bowler.name.split(' ')[1] || bowler.name;
      if (wicketTypeEn === 'Run Out') {
        striker.statusEn = 'OUT (Run Out)';
        striker.statusHi = 'आउट (रन आउट)';
      } else if (wicketTypeEn === 'Bowled') {
        striker.statusEn = `OUT (b ${bowlerShort})`;
        striker.statusHi = `आउट (बोल्ड ${bowlerShort})`;
      } else if (wicketTypeEn === 'LBW') {
        striker.statusEn = `OUT (lbw b ${bowlerShort})`;
        striker.statusHi = `आउट (LBW ${bowlerShort})`;
      } else if (wicketTypeEn === 'Stumped') {
        striker.statusEn = `OUT (st b ${bowlerShort})`;
        striker.statusHi = `आउट (स्टम्प ${bowlerShort})`;
      } else {
        striker.statusEn = `OUT (${wicketTypeEn} b ${bowlerShort})`;
        striker.statusHi = `आउट (${wicketTypeHi} - ${bowlerShort})`;
      }
      this.currentOverBalls.push('W');

      // Bring in next batter
      const nextBatterIdx = Math.max(this.strikerIndex, this.nonStrikerIndex) + 1;
      if (nextBatterIdx < 11 && this.wickets < this.maxWickets) {
        this.strikerIndex = nextBatterIdx;
        this.battingCard[this.strikerIndex].statusEn = 'Batting *';
        this.battingCard[this.strikerIndex].statusHi = 'बल्लेबाजी *';
      }
    } else {
      bowler.consecutiveWickets = 0;
      this.runs += runsScored;
      striker.runs += runsScored;
      bowler.runs += runsScored;
      if (runsScored === 4 && isBoundary) striker.fours++;
      if (runsScored === 6 && isBoundary) striker.sixes++;
      this.currentOverBalls.push(String(runsScored));

      milestoneReached =
        prevStrikerRuns < 100 && striker.runs >= 100
          ? 100
          : prevStrikerRuns < 50 && striker.runs >= 50
            ? 50
            : null;

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

    // Evaluate whether this ball completed the innings or won the match BEFORE clearing currentOverBalls
    const inningsEndState = this.checkInningsEnd();

    // Check End of Over (every 6 legal balls) only if the match/innings hasn't just ended
    let overCompleted = false;
    if (!this.isMatchOver && inningsEndState !== 'innings_break' && this.legalBalls > 0 && this.legalBalls % 6 === 0) {
      overCompleted = true;
      this.swapStrike();
      this.currentOverBalls = [];
      this.rotateBowler();
    }

    return {
      freeHitNext: this.freeHit,
      overCompleted,
      wicketFell: isWicket,
      inningsEndState,
      freeHitDismissalPrevented,
      milestoneReached,
      hatTrickWicket,
      onHatTrickNext: (this.getActiveBowler().consecutiveWickets || 0) === 2
    };
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

  getAvailableBatsmen() {
    return this.battingCard.filter(
      (b) => !b.isOut && b.index !== this.strikerIndex && b.index !== this.nonStrikerIndex
    );
  }

  selectNextBatsman(index) {
    const target = this.battingCard.find(
      (b) => b.index === Number(index) && !b.isOut && b.index !== this.nonStrikerIndex
    );
    if (!target) return false;
    if (this.battingCard[this.strikerIndex] && !this.battingCard[this.strikerIndex].isOut) {
      this.battingCard[this.strikerIndex].statusEn = 'Yet to Bat';
      this.battingCard[this.strikerIndex].statusHi = 'बल्लेबाजी बाकी';
    }
    this.strikerIndex = target.index;
    target.statusEn = 'Batting *';
    target.statusHi = 'बल्लेबाजी *';
    return true;
  }

  getAvailableBowlers() {
    return this.bowlingCard.filter((b) => Math.floor(b.balls / 6) < this.bowlerMaxOvers);
  }

  selectNextBowler(rosterIndex) {
    const target = this.bowlingCard.find((b) => b.rosterIndex === Number(rosterIndex));
    if (!target) return false;
    this.currentBowlerIndex = target.rosterIndex;
    return true;
  }

  /**
   * Simulates the remaining legal balls in the current over with realistic T20/Chase outcomes
   */
  simulateNextOver() {
    if (this.isMatchOver) return { runsInOver: 0, wicketsInOver: 0, ballsSimulated: 0 };
    const startRuns = this.runs;
    const startWickets = this.wickets;
    const startInnings = this.innings;
    const ballsToSim = 6 - (this.legalBalls % 6);
    let ballsSimulated = 0;
    let lastStatus = null;

    for (let i = 0; i < ballsToSim; i++) {
      if (this.isMatchOver || this.innings !== startInnings) break;
      ballsSimulated++;
      const r = Math.random();
      let runsScored = 0;
      let isBoundary = false;
      let isWicket = false;
      let wicketTypeEn = 'Caught';
      let wicketTypeHi = 'कैच आउट';

      if (r < 0.065 && !this.freeHit) {
        isWicket = true;
        const wRoll = Math.random();
        if (wRoll < 0.35) {
          wicketTypeEn = 'Bowled';
          wicketTypeHi = 'बोल्ड';
        } else if (wRoll < 0.55) {
          wicketTypeEn = 'LBW';
          wicketTypeHi = 'एलबीडब्ल्यू';
        }
      } else if (r < 0.36) {
        runsScored = 0;
      } else if (r < 0.68) {
        runsScored = 1;
      } else if (r < 0.78) {
        runsScored = 2;
      } else if (r < 0.91) {
        runsScored = 4;
        isBoundary = true;
      } else {
        runsScored = 6;
        isBoundary = true;
      }

      lastStatus = this.recordDeliveryOutcome({
        runsScored,
        isBoundary,
        isWicket,
        wicketTypeEn,
        wicketTypeHi,
        shotAngleRad: (Math.random() - 0.5) * Math.PI * 1.6,
        shotDistance: isBoundary ? (runsScored === 6 ? 78 : 66) : runsScored * 18
      });
    }

    return {
      runsInOver: Math.max(0, this.runs - startRuns),
      wicketsInOver: Math.max(0, this.wickets - startWickets),
      ballsSimulated,
      inningsChanged: this.innings !== startInnings,
      isMatchOver: this.isMatchOver,
      lastStatus
    };
  }

  checkInningsEnd() {
    const maxBalls = this.totalOvers * 6;
    const allOut = this.wickets >= this.maxWickets;
    const oversDone = this.legalBalls >= maxBalls;

    if (this.innings === 1) {
      if (allOut || oversDone) {
        this.firstInningsTeamNameEn = this.battingTeam.nameEn;
        this.firstInningsTeamNameHi = this.battingTeam.nameHi;
        this.firstInningsTeamShort = this.battingTeam.short;
        this.firstInningsScore = this.runs;
        this.firstInningsWickets = this.wickets;
        this.firstInningsOvers = this.getOversFormatted();
        this.targetRuns = this.firstInningsScore + 1;
        this.firstInningsCard = structuredClone(this.battingCard);
        this.firstInningsBowlingCard = structuredClone(this.bowlingCard);
        this.firstInningsWagon = structuredClone(this.wagonWheel);
        // Switch innings & role for 2nd innings chase
        this.innings = 2;
        this.userRole = this.userRole === 'bat' ? 'bowl' : 'bat';
        this.resetInningsState();
        return 'innings_break';
      }
    } else if (this.innings === 2) {
      const target = (this.firstInningsScore ?? 0) + 1;
      const firstShort = this.firstInningsTeamShort || this.bowlingTeam.short;
      const firstSummary = `${firstShort} ${this.firstInningsScore}/${this.firstInningsWickets} (${this.firstInningsOvers || this.totalOvers + '.0'})`;
      const secondSummary = `${this.battingTeam.short} ${this.runs}/${this.wickets} (${this.getOversFormatted()})`;

      if (this.runs >= target) {
        this.isMatchOver = true;
        const wicketsLeft = Math.max(1, this.maxWickets - this.wickets);
        this.matchSummaryLine = `${secondSummary} vs ${firstSummary}`;
        this.winnerTextEn = `${this.battingTeam.nameEn} won by ${wicketsLeft} wicket${wicketsLeft > 1 ? 's' : ''}! (${secondSummary} vs ${firstSummary})`;
        this.winnerTextHi = `${this.battingTeam.nameHi} ${wicketsLeft} विकेट से जीता! (${secondSummary} बनाम ${firstSummary})`;
        return 'match_over';
      }
      if (allOut || oversDone) {
        if (this.runs === this.firstInningsScore) {
          // Tie! Trigger Super Over!
          this.winnerTextEn = 'MATCH TIED! ENTERING SUPER OVER!';
          this.winnerTextHi = 'मैच टाई! सुपर ओवर शुरू!';
          this.startSuperOver();
          return 'super_over';
        }
        this.isMatchOver = true;
        const margin = Math.max(1, this.firstInningsScore - this.runs);
        this.matchSummaryLine = `${firstSummary} vs ${secondSummary}`;
        this.winnerTextEn = `${this.bowlingTeam.nameEn} won by ${margin} run${margin > 1 ? 's' : ''}! (${firstSummary} vs ${secondSummary})`;
        this.winnerTextHi = `${this.bowlingTeam.nameHi} ${margin} रन से जीता! (${firstSummary} बनाम ${secondSummary})`;
        return 'match_over';
      }
    }
    return null;
  }
}
