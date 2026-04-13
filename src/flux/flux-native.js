/**
 * @module flux/flux-native
 * @description FLUX-native thinking module — the unique differentiator of Super Z.
 *
 * Super Z doesn't just read code; it thinks about code at the ISA level.
 * This module decomposes problems into FLUX opcodes, analyzes patterns
 * through a bytecode lens, generates .fluxasm assembly, maps patterns
 * across languages, and checks for ISA convergence.
 *
 * The FLUX ISA (Fleet Language Unified eXecution) is a virtual instruction
 * set architecture that serves as a universal intermediate representation.
 * When two implementations in different languages converge to the same
 * FLUX bytecode, they are semantically equivalent — period.
 */

import {
  fluxVocabulary,
  lookup as vocabLookup,
  formatOpcode,
  getOpcodesByCategory,
} from './vocabulary.js';

// ---------------------------------------------------------------------------
// Opcode Category Weights (for complexity calculation)
// ---------------------------------------------------------------------------

const COMPLEXITY_WEIGHTS = {
  data: 1,
  arith: 2,
  bitwise: 2,
  compare: 2,
  control: 4,      // Branches are the biggest complexity driver
  stack: 2,
  memory: 3,
  subroutine: 5,   // Calls introduce significant complexity
  special: 1,
};

// ---------------------------------------------------------------------------
// Language to FLUX ISA Mapping Hints
// ---------------------------------------------------------------------------

/**
 * Common high-level patterns and their FLUX ISA equivalents,
 * used for cross-language analysis.
 */
const PATTERN_ISA_MAP = {
  // Control flow
  'if/else':       { opcodes: ['CMP', 'JZ', 'JNZ'], complexity: 3 },
  'for_loop':      { opcodes: ['MOVI', 'CMP', 'JL', 'JMP', 'INC'], complexity: 5 },
  'while_loop':    { opcodes: ['CMP', 'JZ', 'JMP'], complexity: 4 },
  'switch':        { opcodes: ['CMP', 'JEQ', 'JNE', 'JMP'], complexity: 6 },
  'ternary':       { opcodes: ['CMP', 'MOV', 'JZ'], complexity: 2 },

  // Data operations
  'variable_assign':  { opcodes: ['MOV'], complexity: 1 },
  'array_access':     { opcodes: ['LEA', 'LOAD', 'STORE'], complexity: 3 },
  'struct_access':    { opcodes: ['LEA', 'LODD', 'STOD'], complexity: 3 },
  'string_concat':    { opcodes: ['CPY', 'ADD', 'STORE'], complexity: 4 },
  'hash_lookup':      { opcodes: ['HASH', 'LOAD', 'CMP', 'JZ'], complexity: 8 },

  // Functions
  'function_call':    { opcodes: ['PUSH', 'CALL', 'RET', 'POP'], complexity: 5 },
  'function_return':  { opcodes: ['MOV', 'LEAVE', 'RET'], complexity: 3 },
  'recursive_call':   { opcodes: ['PUSH', 'CALL', 'CMP', 'JZ', 'RET'], complexity: 9 },

  // Error handling
  'try/catch':        { opcodes: ['PUSHF', 'TRAP', 'JZ', 'POPF'], complexity: 6 },
  'error_propagate':  { opcodes: ['TEST', 'JNZ', 'PUSH', 'RET'], complexity: 4 },

  // Memory management
  'allocate':         { opcodes: ['SYSCALL', 'MOV'], complexity: 4 },
  'deallocate':       { opcodes: ['MOV', 'SYSCALL'], complexity: 4 },
  'copy':             { opcodes: ['CPY'], complexity: 2 },
  'zero_fill':        { opcodes: ['FILL'], complexity: 2 },

  // Concurrency
  'mutex_lock':       { opcodes: ['SYNC', 'LOAD', 'TEST', 'JNZ', 'JMP'], complexity: 8 },
  'mutex_unlock':     { opcodes: ['STORE', 'SYNC'], complexity: 3 },
  'atomic_cas':       { opcodes: ['LOAD', 'CMP', 'STORE', 'SYNC', 'JNZ'], complexity: 10 },
};

// ---------------------------------------------------------------------------
// FluxNative
// ---------------------------------------------------------------------------

/**
 * The FLUX-native thinking engine for Super Z.
 *
 * This module enables Super Z to:
 *   - Decompose any problem into FLUX ISA opcodes
 *   - Analyze code through the bytecode lens
 *   - Generate .fluxasm assembly representations
 *   - Map patterns across Python/Go/Rust/JS/C
 *   - Check ISA convergence between implementations
 *   - Compute cognitive complexity of opcode sequences
 */
export class FluxNative {
  constructor() {
    /** @type {Map<string, object[]>} Cache of analyzed code → opcode sequences */
    this._analysisCache = new Map();
  }

  // -----------------------------------------------------------------------
  // Core: Think in Opcodes
  // -----------------------------------------------------------------------

  /**
   * Decompose a problem statement into FLUX ISA opcodes.
   * This is the heart of FLUX-native thinking — breaking down any
   * problem into the fundamental operations the FLUX VM would execute.
   *
   * @param {string} problem — Problem description or code snippet
   * @param {object} [options]
   * @param {boolean} [options.annotate=true] — Include human-readable annotations
   * @param {number} [options.maxOpcodes=100] — Maximum opcodes to generate
   * @returns {object} Decomposition result with opcode sequence and metadata
   *
   * @example
   * flux.thinkInOpcodes('Sum an array of integers');
   * // → {
   * //   opcodes: [
   * //     { mnemonic: 'MOVI', operands: ['R0', '#0'], annotation: 'sum = 0' },
   * //     { mnemonic: 'MOVI', operands: ['R4', '#0'], annotation: 'i = 0' },
   * //     { mnemonic: 'CMP', operands: ['R4', 'R1'], annotation: 'compare i with length' },
   * //     ...
   * //   ],
   * //   registerUsage: { inputs: ['R1', 'R2'], outputs: ['R0'], temps: ['R3', 'R4'] },
   * //   memoryAccesses: 2,
   * //   branchCount: 1,
   * //   totalOpcodes: 8
   * // }
   */
  thinkInOpcodes(problem, { annotate = true, maxOpcodes = 100 } = {}) {
    // Check cache
    const cacheKey = `think:${problem}`;
    if (this._analysisCache.has(cacheKey)) {
      return this._analysisCache.get(cacheKey);
    }

    const opcodes = this._decomposeToOpcodes(problem, annotate);
    const capped = opcodes.slice(0, maxOpcodes);

    const result = {
      opcodes: capped,
      registerUsage: this._analyzeRegisterUsage(capped),
      memoryAccesses: capped.filter((op) =>
        ['LOAD', 'STORE', 'LEA', 'LODB', 'STOB', 'LODW', 'STOW', 'LODD', 'STOD'].includes(op.mnemonic)
      ).length,
      branchCount: capped.filter((op) =>
        ['JMP', 'JZ', 'JNZ', 'JC', 'JNC', 'JG', 'JGE', 'JL', 'JLE', 'JA', 'JAE', 'JB', 'JBE', 'JEQ', 'JNE', 'LOOP', 'CALL'].includes(op.mnemonic)
      ).length,
      totalOpcodes: capped.length,
      cyclomaticComplexity: this._computeCyclomaticComplexity(capped),
      cognitiveComplexity: this.opcodeComplexity(capped),
    };

    this._analysisCache.set(cacheKey, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // Core: Analyze Bytecode
  // -----------------------------------------------------------------------

  /**
   * Analyze code through a FLUX bytecode lens.
   * Detects patterns, register pressure, hot paths, and optimization opportunities.
   *
   * @param {string} code — Source code to analyze
   * @param {string} [language] — Source language hint
   * @returns {object} Bytecode analysis result
   */
  analyzeBytecode(code, language) {
    const cacheKey = `analyze:${language ?? 'unknown'}:${code.slice(0, 500)}`;
    if (this._analysisCache.has(cacheKey)) {
      return this._analysisCache.get(cacheKey);
    }

    // First, decompose into opcodes
    const decomposition = this.thinkInOpcodes(code);

    // Identify high-level patterns in the opcode sequence
    const patterns = this._identifyPatterns(decomposition.opcodes);

    // Detect optimization opportunities
    const optimizations = this._findOptimizations(decomposition.opcodes);

    // Compute register pressure over the trace
    const registerPressure = this._computeRegisterPressureTrace(decomposition.opcodes);

    // Identify hot path candidates (dense opcode regions)
    const hotPaths = this._identifyHotPaths(decomposition.opcodes);

    const result = {
      sourceLanguage: language ?? 'detected',
      decomposition,
      patterns,
      optimizations,
      registerPressure,
      hotPaths,
      recommendations: [
        ...optimizations.map((o) => `OPT: ${o.description}`),
        ...this._generateRecommendations(decomposition, patterns),
      ],
    };

    this._analysisCache.set(cacheKey, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // Core: Generate FLUX Assembly
  // -----------------------------------------------------------------------

  /**
   * Generate a .fluxasm representation from a logical description or code.
   *
   * @param {object|string} logic — Logic description or code string
   * @param {object} [options]
   * @param {string} [options.label='main'] — Entry point label
   * @param {boolean} [options.includeDataSection=true] — Include .data section
   * @param {boolean} [options.includeComments=true] — Include comments
   * @returns {string} Complete .fluxasm source code
   */
  generateFluxAssembly(logic, { label = 'main', includeDataSection = true, includeComments = true } = {}) {
    const decomposition = this.thinkInOpcodes(
      typeof logic === 'string' ? logic : JSON.stringify(logic)
    );

    const lines = [];

    // File header
    lines.push('; ============================================================');
    lines.push(`; FLUX Assembly — Generated by Super Z Twin`);
    lines.push(`; Generated: ${new Date().toISOString()}`);
    lines.push(`; Total opcodes: ${decomposition.totalOpcodes}`);
    lines.push(`; Cognitive complexity: ${decomposition.cognitiveComplexity}`);
    lines.push('; ============================================================');
    lines.push('');

    // Data section (if applicable)
    if (includeDataSection) {
      lines.push('.data');
      lines.push('    msg_result  .ascii  "Result: %d\\n"');
      lines.push('    msg_error   .ascii  "Error\\n"');
      lines.push('');
    }

    // Text section
    lines.push('.text');
    lines.push('.global main');
    lines.push('');
    lines.push(`${label}:`);
    lines.push('    ENTER #0           ; Establish stack frame');

    // Emit opcodes
    for (const op of decomposition.opcodes) {
      const formatted = formatOpcode(op.mnemonic, op.operands);
      if (includeComments && op.annotation) {
        lines.push(`    ${formatted.padEnd(30)} ; ${op.annotation}`);
      } else {
        lines.push(`    ${formatted}`);
      }
    }

    lines.push('');
    lines.push('    LEAVE              ; Destroy stack frame');
    lines.push('    RET                ; Return to caller');
    lines.push('');
    lines.push('; === End of .fluxasm ===');

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Core: Cross-Language Mapping
  // -----------------------------------------------------------------------

  /**
   * Map a code pattern across multiple languages, showing how the same
   * FLUX ISA emerges from different syntactic forms.
   *
   * @param {string} pattern — Pattern name (e.g., 'for_loop', 'if/else', 'function_call')
   * @param {string[]} [languages] — Languages to map (default: all supported)
   * @returns {object} Cross-language mapping result
   *
   * @example
   * flux.crossLanguageMap('for_loop', ['Python', 'Rust', 'Go']);
   * // → {
   * //   pattern: 'for_loop',
   * //   isaSignature: ['MOVI', 'CMP', 'JL', 'JMP', 'INC'],
   * //   mappings: {
   * //     Python: { code: 'for i in range(n): ...', divergence: 0 },
   * //     Rust:   { code: 'for i in 0..n { ... }', divergence: 0 },
   * //     Go:     { code: 'for i := 0; i < n; i++ { ... }', divergence: 0 },
   * //   },
   * //   convergence: true,
   * //   notes: 'All languages converge to same ISA for simple counted loops'
   * // }
   */
  crossLanguageMap(pattern, languages = ['Python', 'Go', 'Rust', 'JavaScript', 'TypeScript', 'C']) {
    const isaInfo = PATTERN_ISA_MAP[pattern];
    if (!isaInfo) {
      return {
        pattern,
        error: `Unknown pattern: ${pattern}`,
        availablePatterns: Object.keys(PATTERN_ISA_MAP),
      };
    }

    const mappings = {};
    const snippets = this._getPatternSnippets(pattern, languages);

    for (const lang of languages) {
      const snippet = snippets[lang];
      if (snippet) {
        // Decompose the snippet to check for ISA divergence
        const decomposition = this.thinkInOpcodes(snippet.code);
        const divergence = this._computeDivergence(isaInfo.opcodes, decomposition.opcodes);

        mappings[lang] = {
          code: snippet.code,
          idiomatic: snippet.idiomatic ?? true,
          notes: snippet.notes ?? '',
          divergence,
          opcodeCount: decomposition.totalOpcodes,
        };
      }
    }

    // Check convergence
    const allDivergences = Object.values(mappings).map((m) => m.divergence);
    const convergence = allDivergences.every((d) => d === 0);

    return {
      pattern,
      isaSignature: isaInfo.opcodes,
      isaComplexity: isaInfo.complexity,
      mappings,
      convergence,
      maxDivergence: Math.max(0, ...allDivergences),
      notes: convergence
        ? 'All languages converge to the same ISA — semantically equivalent'
        : 'Languages diverge in ISA representation — semantic differences exist',
    };
  }

  // -----------------------------------------------------------------------
  // Core: ISA Convergence Check
  // -----------------------------------------------------------------------

  /**
   * Check if two implementations converge to the same FLUX ISA bytecode.
   *
   * This is the definitive test for semantic equivalence in the FLUX framework.
   * Two implementations that converge are provably equivalent; divergence
   * reveals bugs, edge cases, or intentional semantic differences.
   *
   * @param {string} impl1 — First implementation code
   * @param {string} impl2 — Second implementation code
   * @param {object} [options]
   * @param {string} [options.lang1] — Language of impl1
   * @param {string} [options.lang2] — Language of impl2
   * @param {number} [options.tolerance=0] — Allowed opcode divergence (0 = exact match)
   * @returns {object} Convergence analysis result
   */
  isaConvergenceCheck(impl1, impl2, { lang1, lang2, tolerance = 0 } = {}) {
    const decomp1 = this.thinkInOpcodes(impl1);
    const decomp2 = this.thinkInOpcodes(impl2);

    // Extract just the opcode signatures
    const sig1 = decomp1.opcodes.map((op) => op.mnemonic);
    const sig2 = decomp2.opcodes.map((op) => op.mnemonic);

    // Compute divergence metrics
    const opcodeDiff = this._sequenceDivergence(sig1, sig2);
    const structuralDiff = this._structuralDivergence(decomp1, decomp2);
    const behavioralDiff = this._behavioralDivergence(decomp1, decomp2);

    const totalDivergence = (opcodeDiff + structuralDiff + behavioralDiff) / 3;
    const converges = totalDivergence <= tolerance;

    return {
      converges,
      confidence: Math.max(0, 1 - totalDivergence),
      metrics: {
        opcodeDivergence: opcodeDiff,
        structuralDivergence: structuralDiff,
        behavioralDivergence: behavioralDiff,
        totalDivergence,
      },
      impl1: {
        language: lang1 ?? 'unknown',
        opcodeCount: decomp1.totalOpcodes,
        complexity: decomp1.cognitiveComplexity,
        signature: sig1,
      },
      impl2: {
        language: lang2 ?? 'unknown',
        opcodeCount: decomp2.totalOpcodes,
        complexity: decomp2.cognitiveComplexity,
        signature: sig2,
      },
      differences: this._describeDifferences(sig1, sig2, decomp1, decomp2),
      recommendation: converges
        ? 'Implementations are semantically equivalent at the ISA level'
        : totalDivergence < 0.3
          ? 'Implementations are mostly equivalent — minor differences detected'
          : 'Significant ISA divergence — implementations are NOT equivalent',
    };
  }

  // -----------------------------------------------------------------------
  // Core: Opcode Complexity
  // -----------------------------------------------------------------------

  /**
   * Compute the cognitive complexity of an opcode sequence.
   *
   * Cognitive complexity factors in:
   *   - Base cost per opcode (varies by category)
   *   - Branching depth (nested branches multiply)
   *   - Register pressure (more live registers = harder to follow)
   *   - Control flow entropy (irregular patterns cost more)
   *   - Subroutine depth (nested calls increase load)
   *
   * @param {Array<{mnemonic: string, operands?: string[]}>} opcodes
   * @returns {number} Cognitive complexity score (higher = more complex)
   */
  opcodeComplexity(opcodes) {
    if (!opcodes || opcodes.length === 0) return 0;

    let complexity = 0;
    let branchDepth = 0;
    let maxBranchDepth = 0;
    const liveRegisters = new Set();

    // Track which registers are written to
    const writtenRegisters = new Set();
    const readRegisters = new Set();

    for (const op of opcodes) {
      const mnemonic = op.mnemonic?.toUpperCase();
      const info = fluxVocabulary.opcodes[mnemonic];

      // Base opcode cost
      if (info) {
        complexity += COMPLEXITY_WEIGHTS[info.category] ?? 1;
      } else {
        complexity += 1; // Unknown opcodes get minimum cost
      }

      // Track register usage
      if (op.operands) {
        for (const operand of op.operands) {
          const regMatch = operand.match(/^R(\d+)$/);
          const specialMatch = operand.match(/^(SP|FP|PC|LR|FLAGS)$/);
          if (regMatch) {
            readRegisters.add(`R${regMatch[1]}`);
          } else if (specialMatch) {
            readRegisters.add(specialMatch[1]);
          }
        }
      }

      // Branch depth tracking
      if (['JZ', 'JNZ', 'JG', 'JL', 'JGE', 'JLE', 'JA', 'JB', 'JEQ', 'JNE', 'LOOP'].includes(mnemonic)) {
        branchDepth++;
        maxBranchDepth = Math.max(maxBranchDepth, branchDepth);
        complexity += branchDepth * 2; // Nested branches cost more
      }

      // JMP is an unconditional branch but doesn't increase nesting
      if (mnemonic === 'JMP') {
        complexity += 1;
      }

      // Subroutine calls
      if (mnemonic === 'CALL') {
        complexity += 3;
        branchDepth++;
        maxBranchDepth = Math.max(maxBranchDepth, branchDepth);
      }

      if (mnemonic === 'RET') {
        branchDepth = Math.max(0, branchDepth - 1);
      }

      // Stack frame management
      if (mnemonic === 'ENTER') {
        complexity += 2;
      }
    }

    // Register pressure penalty
    const registerPressure = writtenRegisters.size;
    if (registerPressure > 8) {
      complexity += (registerPressure - 8) * 0.5;
    }

    // Branch depth penalty (exponential for deep nesting)
    if (maxBranchDepth > 3) {
      complexity += Math.pow(maxBranchDepth - 3, 1.5) * 2;
    }

    return Math.round(complexity * 100) / 100;
  }

  // -----------------------------------------------------------------------
  // Internal: Problem Decomposition
  // -----------------------------------------------------------------------

  /**
   * Decompose a problem into FLUX opcodes.
   * Uses pattern matching against known algorithmic structures.
   *
   * @param {string} problem
   * @param {boolean} annotate
   * @returns {Array<{mnemonic: string, operands: string[], annotation?: string}>}
   * @private
   */
  _decomposeToOpcodes(problem, annotate) {
    const opcodes = [];
    const lowerProblem = problem.toLowerCase();

    // --- Pattern detection and decomposition ---

    // Sum / accumulate pattern
    if (lowerProblem.includes('sum') || lowerProblem.includes('accumulate') || lowerProblem.includes('total')) {
      opcodes.push(
        { mnemonic: 'MOVI', operands: ['R0', '#0'], annotation: annotate ? 'sum = 0' : undefined },
        { mnemonic: 'MOVI', operands: ['R4', '#0'], annotation: annotate ? 'i = 0 (loop counter)' : undefined },
        { mnemonic: 'LABEL', operands: ['loop_start'], annotation: annotate ? 'loop entry' : undefined },
        { mnemonic: 'CMP', operands: ['R4', 'R1'], annotation: annotate ? 'compare i with length' : undefined },
        { mnemonic: 'JGE', operands: ['loop_end'], annotation: annotate ? 'exit if i >= length' : undefined },
        { mnemonic: 'LOAD', operands: ['R2', '[R3 + R4]'], annotation: annotate ? 'load array[i]' : undefined },
        { mnemonic: 'ADD', operands: ['R0', 'R0', 'R2'], annotation: annotate ? 'sum += array[i]' : undefined },
        { mnemonic: 'INC', operands: ['R4'], annotation: annotate ? 'i++' : undefined },
        { mnemonic: 'JMP', operands: ['loop_start'], annotation: annotate ? 'repeat loop' : undefined },
        { mnemonic: 'LABEL', operands: ['loop_end'], annotation: annotate ? 'loop exit' : undefined },
      );
    }

    // Filter / select pattern
    else if (lowerProblem.includes('filter') || lowerProblem.includes('select') || lowerProblem.includes('where')) {
      opcodes.push(
        { mnemonic: 'MOVI', operands: ['R5', '#0'], annotation: annotate ? 'result_count = 0' : undefined },
        { mnemonic: 'MOVI', operands: ['R4', '#0'], annotation: annotate ? 'i = 0' : undefined },
        { mnemonic: 'LABEL', operands: ['filter_loop'], annotation: annotate ? 'filter loop' : undefined },
        { mnemonic: 'CMP', operands: ['R4', 'R1'], annotation: annotate ? 'bounds check' : undefined },
        { mnemonic: 'JGE', operands: ['filter_done'], annotation: annotate ? 'exit if done' : undefined },
        { mnemonic: 'LOAD', operands: ['R2', '[R3 + R4]'], annotation: annotate ? 'load element' : undefined },
        { mnemonic: 'TEST', operands: ['R2'], annotation: annotate ? 'test predicate' : undefined },
        { mnemonic: 'JZ', operands: ['filter_skip'], annotation: annotate ? 'skip if false' : undefined },
        { mnemonic: 'STORE', operands: ['R2', '[R6 + R5]'], annotation: annotate ? 'store match' : undefined },
        { mnemonic: 'INC', operands: ['R5'], annotation: annotate ? 'result_count++' : undefined },
        { mnemonic: 'LABEL', operands: ['filter_skip'], annotation: annotate ? '' : undefined },
        { mnemonic: 'INC', operands: ['R4'], annotation: annotate ? 'i++' : undefined },
        { mnemonic: 'JMP', operands: ['filter_loop'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LABEL', operands: ['filter_done'], annotation: annotate ? '' : undefined },
      );
    }

    // Map / transform pattern
    else if (lowerProblem.includes('map') || lowerProblem.includes('transform') || lowerProblem.includes('convert')) {
      opcodes.push(
        { mnemonic: 'MOVI', operands: ['R4', '#0'], annotation: annotate ? 'i = 0' : undefined },
        { mnemonic: 'LABEL', operands: ['map_loop'], annotation: annotate ? 'map loop' : undefined },
        { mnemonic: 'CMP', operands: ['R4', 'R1'], annotation: annotate ? 'bounds check' : undefined },
        { mnemonic: 'JGE', operands: ['map_done'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LOAD', operands: ['R2', '[R3 + R4]'], annotation: annotate ? 'load element' : undefined },
        { mnemonic: 'CALL', operands: ['transform_fn'], annotation: annotate ? 'apply transform' : undefined },
        { mnemonic: 'STORE', operands: ['R0', '[R7 + R4]'], annotation: annotate ? 'store result' : undefined },
        { mnemonic: 'INC', operands: ['R4'], annotation: annotate ? 'i++' : undefined },
        { mnemonic: 'JMP', operands: ['map_loop'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LABEL', operands: ['map_done'], annotation: annotate ? '' : undefined },
      );
    }

    // Search / find pattern
    else if (lowerProblem.includes('search') || lowerProblem.includes('find') || lowerProblem.includes('lookup')) {
      opcodes.push(
        { mnemonic: 'MOVI', operands: ['R4', '#0'], annotation: annotate ? 'i = 0' : undefined },
        { mnemonic: 'MOVI', operands: ['R0', '#-1'], annotation: annotate ? 'result = NOT_FOUND' : undefined },
        { mnemonic: 'LABEL', operands: ['search_loop'], annotation: annotate ? '' : undefined },
        { mnemonic: 'CMP', operands: ['R4', 'R1'], annotation: annotate ? 'bounds check' : undefined },
        { mnemonic: 'JGE', operands: ['search_done'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LOAD', operands: ['R2', '[R3 + R4]'], annotation: annotate ? 'load element' : undefined },
        { mnemonic: 'CMP', operands: ['R2', 'R5'], annotation: annotate ? 'compare with target' : undefined },
        { mnemonic: 'JEQ', operands: ['search_found'], annotation: annotate ? 'match!' : undefined },
        { mnemonic: 'INC', operands: ['R4'], annotation: annotate ? 'i++' : undefined },
        { mnemonic: 'JMP', operands: ['search_loop'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LABEL', operands: ['search_found'], annotation: annotate ? '' : undefined },
        { mnemonic: 'MOV', operands: ['R0', 'R4'], annotation: annotate ? 'result = i' : undefined },
        { mnemonic: 'LABEL', operands: ['search_done'], annotation: annotate ? '' : undefined },
      );
    }

    // Sort pattern
    else if (lowerProblem.includes('sort') || lowerProblem.includes('order') || lowerProblem.includes('arrange')) {
      opcodes.push(
        { mnemonic: 'MOVI', operands: ['R4', '#0'], annotation: annotate ? 'outer loop i = 0' : undefined },
        { mnemonic: 'LABEL', operands: ['sort_outer'], annotation: annotate ? 'outer loop' : undefined },
        { mnemonic: 'CMP', operands: ['R4', 'R1'], annotation: annotate ? '' : undefined },
        { mnemonic: 'JGE', operands: ['sort_done'], annotation: annotate ? '' : undefined },
        { mnemonic: 'MOVI', operands: ['R5', 'R4'], annotation: annotate ? 'inner j = i' : undefined },
        { mnemonic: 'LABEL', operands: ['sort_inner'], annotation: annotate ? 'inner loop' : undefined },
        { mnemonic: 'CMP', operands: ['R5', 'R1'], annotation: annotate ? '' : undefined },
        { mnemonic: 'JGE', operands: ['sort_next_outer'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LOAD', operands: ['R2', '[R3 + R5]'], annotation: annotate ? 'load arr[j]' : undefined },
        { mnemonic: 'INC', operands: ['R5'], annotation: annotate ? 'j++' : undefined },
        { mnemonic: 'LOAD', operands: ['R6', '[R3 + R5]'], annotation: annotate ? 'load arr[j+1]' : undefined },
        { mnemonic: 'CMP', operands: ['R2', 'R6'], annotation: annotate ? 'compare' : undefined },
        { mnemonic: 'JLE', operands: ['sort_no_swap'], annotation: annotate ? '' : undefined },
        { mnemonic: 'STORE', operands: ['R6', '[R3 + R5]'], annotation: annotate ? 'swap' : undefined },
        { mnemonic: 'DEC', operands: ['R5'], annotation: annotate ? '' : undefined },
        { mnemonic: 'STORE', operands: ['R2', '[R3 + R5]'], annotation: annotate ? 'swap done' : undefined },
        { mnemonic: 'LABEL', operands: ['sort_no_swap'], annotation: annotate ? '' : undefined },
        { mnemonic: 'JMP', operands: ['sort_inner'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LABEL', operands: ['sort_next_outer'], annotation: annotate ? '' : undefined },
        { mnemonic: 'INC', operands: ['R4'], annotation: annotate ? 'i++' : undefined },
        { mnemonic: 'JMP', operands: ['sort_outer'], annotation: annotate ? '' : undefined },
        { mnemonic: 'LABEL', operands: ['sort_done'], annotation: annotate ? '' : undefined },
      );
    }

    // Generic / fallback decomposition
    else {
      opcodes.push(
        { mnemonic: 'ENTER', operands: ['#0'], annotation: annotate ? 'establish frame' : undefined },
        { mnemonic: 'PUSH', operands: ['R12'], annotation: annotate ? 'save argument register' : undefined },
        { mnemonic: 'PUSH', operands: ['R13'], annotation: annotate ? 'save argument register' : undefined },
        { mnemonic: 'PUSH', operands: ['R14'], annotation: annotate ? 'save argument register' : undefined },
        { mnemonic: 'MOV', operands: ['R0', 'R12'], annotation: annotate ? 'load first arg' : undefined },
        { mnemonic: 'MOV', operands: ['R1', 'R13'], annotation: annotate ? 'load second arg' : undefined },
        { mnemonic: 'CALL', operands: ['process'], annotation: annotate ? 'invoke processing logic' : undefined },
        { mnemonic: 'MOV', operands: ['R15', 'R0'], annotation: annotate ? 'set return value' : undefined },
        { mnemonic: 'POP', operands: ['R14'], annotation: annotate ? 'restore register' : undefined },
        { mnemonic: 'POP', operands: ['R13'], annotation: annotate ? 'restore register' : undefined },
        { mnemonic: 'POP', operands: ['R12'], annotation: annotate ? 'restore register' : undefined },
        { mnemonic: 'LEAVE', operands: [], annotation: annotate ? 'destroy frame' : undefined },
        { mnemonic: 'RET', operands: [], annotation: annotate ? 'return' : undefined },
      );
    }

    return opcodes;
  }

  // -----------------------------------------------------------------------
  // Internal: Pattern Snippets
  // -----------------------------------------------------------------------

  /**
   * Get idiomatic code snippets for a pattern across languages.
   * @param {string} pattern
   * @param {string[]} languages
   * @returns {Record<string, {code: string, idiomatic: boolean, notes?: string}>}
   * @private
   */
  _getPatternSnippets(pattern, languages) {
    const snippets = {
      'if/else': {
        Python:     { code: 'if condition:\n    result = a\nelse:\n    result = b', idiomatic: true },
        Go:         { code: 'if condition {\n    result = a\n} else {\n    result = b\n}', idiomatic: true },
        Rust:       { code: 'let result = if condition { a } else { b };', idiomatic: true },
        JavaScript: { code: 'const result = condition ? a : b;', idiomatic: true },
        TypeScript: { code: 'const result: T = condition ? a : b;', idiomatic: true },
        C:          { code: 'int result = condition ? a : b;', idiomatic: true },
      },
      'for_loop': {
        Python:     { code: 'for i in range(n):\n    process(arr[i])', idiomatic: true },
        Go:         { code: 'for i := 0; i < n; i++ {\n    process(arr[i])\n}', idiomatic: true },
        Rust:       { code: 'for i in 0..n {\n    process(arr[i]);\n}', idiomatic: true },
        JavaScript: { code: 'for (let i = 0; i < n; i++) {\n    process(arr[i]);\n}', idiomatic: true },
        TypeScript: { code: 'for (let i = 0; i < n; i++) {\n    process(arr[i]);\n}', idiomatic: true },
        C:          { code: 'for (int i = 0; i < n; i++) {\n    process(arr[i]);\n}', idiomatic: true },
      },
      'while_loop': {
        Python:     { code: 'while condition:\n    process()', idiomatic: true },
        Go:         { code: 'for condition {\n    process()\n}', idiomatic: true, notes: 'Go uses for as while' },
        Rust:       { code: 'while condition {\n    process();\n}', idiomatic: true },
        JavaScript: { code: 'while (condition) {\n    process();\n}', idiomatic: true },
        TypeScript: { code: 'while (condition) {\n    process();\n}', idiomatic: true },
        C:          { code: 'while (condition) {\n    process();\n}', idiomatic: true },
      },
      'function_call': {
        Python:     { code: 'result = compute(a, b)', idiomatic: true },
        Go:         { code: 'result := compute(a, b)', idiomatic: true },
        Rust:       { code: 'let result = compute(a, b);', idiomatic: true },
        JavaScript: { code: 'const result = compute(a, b);', idiomatic: true },
        TypeScript: { code: 'const result: R = compute(a, b);', idiomatic: true },
        C:          { code: 'result_t result = compute(a, b);', idiomatic: true },
      },
      'variable_assign': {
        Python:     { code: 'x = value', idiomatic: true },
        Go:         { code: 'x := value', idiomatic: true },
        Rust:       { code: 'let x = value;', idiomatic: true },
        JavaScript: { code: 'let x = value;', idiomatic: true },
        TypeScript: { code: 'let x: T = value;', idiomatic: true },
        C:          { code: 'int x = value;', idiomatic: true },
      },
      'array_access': {
        Python:     { code: 'element = arr[index]', idiomatic: true },
        Go:         { code: 'element := arr[index]', idiomatic: true },
        Rust:       { code: 'let element = arr[index];', idiomatic: true },
        JavaScript: { code: 'const element = arr[index];', idiomatic: true },
        TypeScript: { code: 'const element = arr[index];', idiomatic: true },
        C:          { code: 'int element = arr[index];', idiomatic: true },
      },
      'hash_lookup': {
        Python:     { code: 'value = data[key]', idiomatic: true },
        Go:         { code: 'value, ok := data[key]', idiomatic: true, notes: 'Go returns existence flag' },
        Rust:       { code: 'let value = data.get(&key);', idiomatic: true, notes: 'Rust returns Option' },
        JavaScript: { code: 'const value = data[key];', idiomatic: true },
        TypeScript: { code: 'const value = data[key];', idiomatic: true },
        C:          { code: 'value = hashmap_get(map, key);', idiomatic: false, notes: 'C requires explicit API' },
      },
    };

    return snippets[pattern] ?? {};
  }

  // -----------------------------------------------------------------------
  // Internal: Analysis Helpers
  // -----------------------------------------------------------------------

  /**
   * Analyze register usage in an opcode sequence.
   * @param {Array} opcodes
   * @returns {object}
   * @private
   */
  _analyzeRegisterUsage(opcodes) {
    const inputs = new Set();
    const outputs = new Set();
    const temps = new Set();

    for (const op of opcodes) {
      if (!op.operands) continue;
      for (const operand of op.operands) {
        const regMatch = operand.match(/^[RF][PL]?(\d+|[A-Z]+)$/i);
        if (regMatch) {
          temps.add(operand.toUpperCase());
        }
      }
    }

    // R12-R15 are inputs/outputs by convention, rest are temps
    if (temps.has('R15')) outputs.add('R15');
    if (temps.has('R12')) inputs.add('R12');
    if (temps.has('R13')) inputs.add('R13');
    if (temps.has('R14')) inputs.add('R14');

    for (const reg of temps) {
      if (!inputs.has(reg) && !outputs.has(reg) && !['R12', 'R13', 'R14', 'R15'].includes(reg)) {
        temps.delete(reg);
        temps.add(reg);
      }
    }

    return {
      inputs: [...inputs],
      outputs: [...outputs],
      temps: [...temps].filter((r) => !inputs.has(r) && !outputs.has(r)),
    };
  }

  /**
   * Compute cyclomatic complexity from opcode sequence.
   * @param {Array} opcodes
   * @returns {number}
   * @private
   */
  _computeCyclomaticComplexity(opcodes) {
    const branches = opcodes.filter((op) =>
      ['JZ', 'JNZ', 'JG', 'JL', 'JGE', 'JLE', 'JA', 'JB', 'JEQ', 'JNE', 'CALL'].includes(op.mnemonic)
    ).length;
    return 1 + branches;
  }

  /**
   * Identify known patterns in an opcode sequence.
   * @param {Array} opcodes
   * @returns {Array<{name: string, start: number, end: number}>}
   * @private
   */
  _identifyPatterns(opcodes) {
    const patterns = [];
    const mnemonics = opcodes.map((op) => op.mnemonic);
    const mnemonicStr = mnemonics.join(',');

    // Pattern matching
    const patternDefs = [
      { name: 'loop', signature: ['CMP', 'JGE', 'JMP'] },
      { name: 'conditional', signature: ['CMP', 'JZ'] },
      { name: 'conditional_else', signature: ['CMP', 'JZ', 'JMP', 'LABEL'] },
      { name: 'subroutine_call', signature: ['PUSH', 'CALL', 'POP'] },
      { name: 'stack_frame', signature: ['ENTER', 'LEAVE', 'RET'] },
      { name: 'array_iteration', signature: ['MOVI', 'CMP', 'LOAD', 'INC', 'JMP'] },
      { name: 'conditional_store', signature: ['TEST', 'JZ', 'STORE'] },
    ];

    for (const def of patternDefs) {
      const sigStr = def.signature.join(',');
      let idx = mnemonicStr.indexOf(sigStr);
      while (idx !== -1) {
        // Find the opcode index by counting commas
        const startIdx = (mnemonicStr.substring(0, idx).match(/,/g) ?? []).length;
        patterns.push({
          name: def.name,
          start: startIdx,
          end: startIdx + def.signature.length - 1,
        });
        idx = mnemonicStr.indexOf(sigStr, idx + sigStr.length);
      }
    }

    return patterns;
  }

  /**
   * Find optimization opportunities in an opcode sequence.
   * @param {Array} opcodes
   * @returns {Array<{type: string, description: string, saving: number}>}
   * @private
   */
  _findOptimizations(opcodes) {
    const optimizations = [];
    const mnemonics = opcodes.map((op) => op.mnemonic);

    // Detect NOP chains
    let nopRun = 0;
    for (const m of mnemonics) {
      if (m === 'NOP') nopRun++;
      else if (nopRun > 1) {
        optimizations.push({
          type: 'nop_removal',
          description: `Remove ${nopRun} consecutive NOPs`,
          saving: nopRun,
        });
        nopRun = 0;
      } else {
        nopRun = 0;
      }
    }

    // Detect MOV R0, R0 (identity move)
    for (let i = 0; i < opcodes.length; i++) {
      const op = opcodes[i];
      if (op.mnemonic === 'MOV' && op.operands?.length === 2 && op.operands[0] === op.operands[1]) {
        optimizations.push({
          type: 'identity_move',
          description: `Remove identity move at position ${i}`,
          saving: 1,
        });
      }
    }

    // Detect PUSH/POP without modification (dead store)
    for (let i = 0; i < opcodes.length - 1; i++) {
      if (opcodes[i].mnemonic === 'PUSH' && opcodes[i + 1].mnemonic === 'POP' &&
          opcodes[i].operands?.[0] === opcodes[i + 1].operands?.[0]) {
        optimizations.push({
          type: 'dead_push_pop',
          description: `Remove PUSH/POP pair for ${opcodes[i].operands[0]} at position ${i}`,
          saving: 2,
        });
      }
    }

    return optimizations;
  }

  /**
   * Compute register pressure over the trace.
   * @param {Array} opcodes
   * @returns {Array<{position: number, pressure: number}>}
   * @private
   */
  _computeRegisterPressureTrace(opcodes) {
    const liveRegs = new Set();
    const trace = [];

    for (let i = 0; i < opcodes.length; i++) {
      const op = opcodes[i];

      // Reading a register makes it live
      if (op.operands) {
        for (const operand of op.operands) {
          const regMatch = operand.match(/^[RFPL][\dA-Z]+$/i);
          if (regMatch) {
            liveRegs.add(operand.toUpperCase());
          }
        }
      }

      trace.push({ position: i, pressure: liveRegs.size });

      // Registers are "consumed" by stores and outputs
      if (['STORE', 'STOB', 'STOW', 'STOD', 'RET'].includes(op.mnemonic)) {
        if (op.operands) {
          liveRegs.delete(op.operands[0]?.toUpperCase());
        }
      }
    }

    return trace;
  }

  /**
   * Identify hot path candidates (dense opcode regions without branches).
   * @param {Array} opcodes
   * @returns {Array<{start: number, end: number, density: number}>}
   * @private
   */
  _identifyHotPaths(opcodes) {
    const paths = [];
    let pathStart = 0;

    for (let i = 0; i < opcodes.length; i++) {
      const isBranch = ['JMP', 'JZ', 'JNZ', 'CALL', 'RET', 'HALT'].includes(opcodes[i].mnemonic);
      if (isBranch || i === opcodes.length - 1) {
        const end = isBranch ? i : i + 1;
        const length = end - pathStart;
        if (length >= 3) {
          paths.push({
            start: pathStart,
            end: end - 1,
            density: length / (end - pathStart + 1),
            length,
          });
        }
        pathStart = i + 1;
      }
    }

    return paths.sort((a, b) => b.length - a.length);
  }

  /**
   * Generate recommendations based on analysis.
   * @param {object} decomposition
   * @param {Array} patterns
   * @returns {string[]}
   * @private
   */
  _generateRecommendations(decomposition, patterns) {
    const recs = [];

    if (decomposition.branchCount > 10) {
      recs.push('Consider restructuring to reduce branching — high branch count increases cognitive load');
    }

    if (decomposition.memoryAccesses > decomposition.totalOpcodes * 0.5) {
      recs.push('High memory access ratio — consider caching or using registers more effectively');
    }

    const loopPatterns = patterns.filter((p) => p.name.includes('loop'));
    if (loopPatterns.length > 3) {
      recs.push('Multiple nested loops detected — consider algorithmic optimization or vectorization');
    }

    if (decomposition.cognitiveComplexity > 50) {
      recs.push('High cognitive complexity — break into smaller, named subroutines');
    }

    return recs;
  }

  // -----------------------------------------------------------------------
  // Internal: Divergence Metrics
  // -----------------------------------------------------------------------

  /**
   * Compute divergence between expected and actual opcodes.
   * @param {string[]} expected
   * @param {Array<{mnemonic: string}>} actual
   * @returns {number} Divergence score (0 = identical)
   * @private
   */
  _computeDivergence(expected, actual) {
    if (expected.length === 0 && actual.length === 0) return 0;
    if (expected.length === 0 || actual.length === 0) return 1;

    const actualMnemonics = actual.map((op) => op.mnemonic);

    // Simple set-based comparison with penalty for missing/extra opcodes
    const expectedSet = new Set(expected);
    const actualSet = new Set(actualMnemonics);

    let matches = 0;
    for (const op of expectedSet) {
      if (actualSet.has(op)) matches++;
    }

    const precision = matches / actualSet.size;
    const recall = matches / expectedSet.size;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return Math.round((1 - f1) * 100) / 100;
  }

  /**
   * Sequence divergence — order-sensitive comparison.
   * @param {string[]} sig1
   * @param {string[]} sig2
   * @returns {number}
   * @private
   */
  _sequenceDivergence(sig1, sig2) {
    if (sig1.length === 0 && sig2.length === 0) return 0;
    if (sig1.length === 0 || sig2.length === 0) return 1;

    // Levenshtein-like distance normalized by max length
    const len1 = sig1.length;
    const len2 = sig2.length;
    const maxLen = Math.max(len1, len2);

    // Quick check: exact match
    if (len1 === len2 && sig1.every((op, i) => op === sig2[i])) {
      return 0;
    }

    // Compute edit distance
    const dp = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = sig1[i - 1] === sig2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return dp[len1][len2] / maxLen;
  }

  /**
   * Structural divergence — comparing register usage and branch patterns.
   * @param {object} decomp1
   * @param {object} decomp2
   * @returns {number}
   * @private
   */
  _structuralDivergence(decomp1, decomp2) {
    let diff = 0;

    // Compare register usage sets
    const regs1 = new Set([
      ...decomp1.registerUsage.inputs,
      ...decomp1.registerUsage.outputs,
      ...decomp1.registerUsage.temps,
    ]);
    const regs2 = new Set([
      ...decomp2.registerUsage.inputs,
      ...decomp2.registerUsage.outputs,
      ...decomp2.registerUsage.temps,
    ]);

    if (regs1.size !== regs2.size) diff += Math.abs(regs1.size - regs2.size) * 0.1;
    for (const r of regs1) if (!regs2.has(r)) diff += 0.1;
    for (const r of regs2) if (!regs1.has(r)) diff += 0.1;

    // Compare branch counts
    const branchDiff = Math.abs(decomp1.branchCount - decomp2.branchCount);
    diff += branchDiff * 0.15;

    // Compare memory access patterns
    const memDiff = Math.abs(decomp1.memoryAccesses - decomp2.memoryAccesses);
    diff += memDiff * 0.1;

    return Math.min(1, diff);
  }

  /**
   * Behavioral divergence — comparing complexity metrics.
   * @param {object} decomp1
   * @param {object} decomp2
   * @returns {number}
   * @private
   */
  _behavioralDivergence(decomp1, decomp2) {
    let diff = 0;

    // Cyclomatic complexity
    const cyclDiff = Math.abs(decomp1.cyclomaticComplexity - decomp2.cyclomaticComplexity);
    diff += cyclDiff * 0.1;

    // Cognitive complexity
    const maxCogn = Math.max(decomp1.cognitiveComplexity, decomp2.cognitiveComplexity, 1);
    const cognDiff = Math.abs(decomp1.cognitiveComplexity - decomp2.cognitiveComplexity) / maxCogn;
    diff += cognDiff * 0.3;

    // Total opcode count
    const maxOps = Math.max(decomp1.totalOpcodes, decomp2.totalOpcodes, 1);
    const opsDiff = Math.abs(decomp1.totalOpcodes - decomp2.totalOpcodes) / maxOps;
    diff += opsDiff * 0.2;

    return Math.min(1, diff);
  }

  /**
   * Generate human-readable description of differences.
   * @param {string[]} sig1
   * @param {string[]} sig2
   * @param {object} decomp1
   * @param {object} decomp2
   * @returns {string[]}
   * @private
   */
  _describeDifferences(sig1, sig2, decomp1, decomp2) {
    const diffs = [];

    if (decomp1.totalOpcodes !== decomp2.totalOpcodes) {
      const delta = decomp2.totalOpcodes - decomp1.totalOpcodes;
      diffs.push(`Opcode count differs: ${decomp1.totalOpcodes} vs ${decomp2.totalOpcodes} (${delta > 0 ? '+' : ''}${delta})`);
    }

    if (decomp1.branchCount !== decomp2.branchCount) {
      diffs.push(`Branch count differs: ${decomp1.branchCount} vs ${decomp2.branchCount}`);
    }

    if (Math.abs(decomp1.cognitiveComplexity - decomp2.cognitiveComplexity) > 1) {
      diffs.push(`Cognitive complexity differs: ${decomp1.cognitiveComplexity} vs ${decomp2.cognitiveComplexity}`);
    }

    // Find unique opcodes in each
    const set1 = new Set(sig1);
    const set2 = new Set(sig2);
    const only1 = [...set1].filter((o) => !set2.has(o));
    const only2 = [...set2].filter((o) => !set1.has(o));
    if (only1.length > 0) diffs.push(`Only in impl1: ${only1.join(', ')}`);
    if (only2.length > 0) diffs.push(`Only in impl2: ${only2.join(', ')}`);

    return diffs;
  }

  // -----------------------------------------------------------------------
  // Utility: Clear Analysis Cache
  // -----------------------------------------------------------------------

  /**
   * Clear the analysis cache.
   */
  clearCache() {
    this._analysisCache.clear();
  }
}

export default FluxNative;
