/**
 * @module flux/vocabulary
 * @description Complete FLUX ISA vocabulary module.
 * Defines registers, opcodes, addressing modes, flags, directives,
 * and conceptual terminology used by Super Z's FLUX-native thinking.
 *
 * This is the linguistic foundation of the FLUX assembly language —
 * a virtual ISA that captures the essence of computation across languages.
 */

// ---------------------------------------------------------------------------
// FLUX Vocabulary
// ---------------------------------------------------------------------------

/**
 * The complete FLUX vocabulary, organized by category.
 * @type {object}
 */
export const fluxVocabulary = Object.freeze({

  // -----------------------------------------------------------------------
  // Registers — 16 general-purpose + 5 special-purpose
  // -----------------------------------------------------------------------
  registers: Object.freeze({
    // General-purpose registers (R0–R15)
    R0:  { number: 0,  description: 'General-purpose register 0 — accumulator primary', category: 'general' },
    R1:  { number: 1,  description: 'General-purpose register 1 — accumulator secondary', category: 'general' },
    R2:  { number: 2,  description: 'General-purpose register 2 — base address / pointer', category: 'general' },
    R3:  { number: 3,  description: 'General-purpose register 3 — index register', category: 'general' },
    R4:  { number: 4,  description: 'General-purpose register 4 — loop counter', category: 'general' },
    R5:  { number: 5,  description: 'General-purpose register 5 — temporary', category: 'general' },
    R6:  { number: 6,  description: 'General-purpose register 6 — temporary', category: 'general' },
    R7:  { number: 7,  description: 'General-purpose register 7 — temporary', category: 'general' },
    R8:  { number: 8,  description: 'General-purpose register 8 — callee-saved', category: 'general' },
    R9:  { number: 9,  description: 'General-purpose register 9 — callee-saved', category: 'general' },
    R10: { number: 10, description: 'General-purpose register 10 — callee-saved', category: 'general' },
    R11: { number: 11, description: 'General-purpose register 11 — callee-saved', category: 'general' },
    R12: { number: 12, description: 'General-purpose register 12 — argument', category: 'general' },
    R13: { number: 13, description: 'General-purpose register 13 — argument', category: 'general' },
    R14: { number: 14, description: 'General-purpose register 14 — argument', category: 'general' },
    R15: { number: 15, description: 'General-purpose register 15 — argument / return value', category: 'general' },

    // Special-purpose registers
    SP:    { number: -1, description: 'Stack Pointer — top of the call stack', category: 'special' },
    FP:    { number: -2, description: 'Frame Pointer — current stack frame base', category: 'special' },
    PC:    { number: -3, description: 'Program Counter — current instruction address', category: 'special' },
    FLAGS: { number: -4, description: 'Flags Register — status flags (ZERO, CARRY, etc.)', category: 'special' },
    LR:    { number: -5, description: 'Link Register — return address for calls', category: 'special' },
  }),

  // -----------------------------------------------------------------------
  // Opcodes — 55 instruction opcodes
  // -----------------------------------------------------------------------
  opcodes: Object.freeze({
    // ── Data Movement ──
    MOV:    { code: 0x01, category: 'data',   operands: 2, description: 'Move data between registers or load immediate', cycles: 1 },
    MOVI:   { code: 0x02, category: 'data',   operands: 2, description: 'Move immediate value into register', cycles: 1 },
    MOVZ:   { code: 0x03, category: 'data',   operands: 2, description: 'Move with zero extension', cycles: 1 },
    MOVS:   { code: 0x04, category: 'data',   operands: 2, description: 'Move with sign extension', cycles: 1 },
    SWAP:   { code: 0x05, category: 'data',   operands: 2, description: 'Swap contents of two registers', cycles: 1 },

    // ── Arithmetic ──
    ADD:    { code: 0x10, category: 'arith',  operands: 3, description: 'Add two operands, store result', cycles: 1 },
    ADDI:   { code: 0x11, category: 'arith',  operands: 3, description: 'Add immediate to register', cycles: 1 },
    SUB:    { code: 0x12, category: 'arith',  operands: 3, description: 'Subtract second operand from first', cycles: 1 },
    SUBI:   { code: 0x13, category: 'arith',  operands: 3, description: 'Subtract immediate from register', cycles: 1 },
    MUL:    { code: 0x14, category: 'arith',  operands: 3, description: 'Multiply two operands', cycles: 3 },
    DIV:    { code: 0x15, category: 'arith',  operands: 3, description: 'Divide first operand by second', cycles: 8 },
    MOD:    { code: 0x16, category: 'arith',  operands: 3, description: 'Remainder of division', cycles: 8 },
    INC:    { code: 0x17, category: 'arith',  operands: 1, description: 'Increment register by 1', cycles: 1 },
    DEC:    { code: 0x18, category: 'arith',  operands: 1, description: 'Decrement register by 1', cycles: 1 },
    NEG:    { code: 0x19, category: 'arith',  operands: 2, description: 'Negate (two\'s complement)', cycles: 1 },
    ABS:    { code: 0x1A, category: 'arith',  operands: 2, description: 'Absolute value', cycles: 1 },
    MIN:    { code: 0x1B, category: 'arith',  operands: 3, description: 'Minimum of two values', cycles: 1 },
    MAX:    { code: 0x1C, category: 'arith',  operands: 3, description: 'Maximum of two values', cycles: 1 },

    // ── Bitwise ──
    AND:    { code: 0x20, category: 'bitwise', operands: 3, description: 'Bitwise AND', cycles: 1 },
    OR:     { code: 0x21, category: 'bitwise', operands: 3, description: 'Bitwise OR', cycles: 1 },
    XOR:    { code: 0x22, category: 'bitwise', operands: 3, description: 'Bitwise XOR (exclusive OR)', cycles: 1 },
    NOT:    { code: 0x23, category: 'bitwise', operands: 2, description: 'Bitwise NOT (complement)', cycles: 1 },
    SHL:    { code: 0x24, category: 'bitwise', operands: 3, description: 'Shift left', cycles: 1 },
    SHR:    { code: 0x25, category: 'bitwise', operands: 3, description: 'Shift right (logical)', cycles: 1 },
    SAR:    { code: 0x26, category: 'bitwise', operands: 3, description: 'Shift right (arithmetic)', cycles: 1 },
    ROL:    { code: 0x27, category: 'bitwise', operands: 3, description: 'Rotate left through carry', cycles: 1 },
    ROR:    { code: 0x28, category: 'bitwise', operands: 3, description: 'Rotate right through carry', cycles: 1 },

    // ── Comparison ──
    CMP:    { code: 0x30, category: 'compare', operands: 2, description: 'Compare two operands (sets FLAGS)', cycles: 1 },
    CMPI:   { code: 0x31, category: 'compare', operands: 2, description: 'Compare register with immediate', cycles: 1 },
    TEST:   { code: 0x32, category: 'compare', operands: 2, description: 'Bitwise test (AND without storing)', cycles: 1 },

    // ── Control Flow ──
    JMP:    { code: 0x40, category: 'control', operands: 1, description: 'Unconditional jump', cycles: 2 },
    JZ:     { code: 0x41, category: 'control', operands: 1, description: 'Jump if ZERO flag set', cycles: 2 },
    JNZ:    { code: 0x42, category: 'control', operands: 1, description: 'Jump if ZERO flag clear', cycles: 2 },
    JC:     { code: 0x43, category: 'control', operands: 1, description: 'Jump if CARRY flag set', cycles: 2 },
    JNC:    { code: 0x44, category: 'control', operands: 1, description: 'Jump if CARRY flag clear', cycles: 2 },
    JG:     { code: 0x45, category: 'control', operands: 1, description: 'Jump if GREATER (signed)', cycles: 2 },
    JGE:    { code: 0x46, category: 'control', operands: 1, description: 'Jump if GREATER or EQUAL (signed)', cycles: 2 },
    JL:     { code: 0x47, category: 'control', operands: 1, description: 'Jump if LESS (signed)', cycles: 2 },
    JLE:    { code: 0x48, category: 'control', operands: 1, description: 'Jump if LESS or EQUAL (signed)', cycles: 2 },
    JA:     { code: 0x49, category: 'control', operands: 1, description: 'Jump if ABOVE (unsigned)', cycles: 2 },
    JAE:    { code: 0x4A, category: 'control', operands: 1, description: 'Jump if ABOVE or EQUAL (unsigned)', cycles: 2 },
    JB:     { code: 0x4B, category: 'control', operands: 1, description: 'Jump if BELOW (unsigned)', cycles: 2 },
    JBE:    { code: 0x4C, category: 'control', operands: 1, description: 'Jump if BELOW or EQUAL (unsigned)', cycles: 2 },
    JEQ:    { code: 0x4D, category: 'control', operands: 1, description: 'Jump if EQUAL (alias for JZ)', cycles: 2 },
    JNE:    { code: 0x4E, category: 'control', operands: 1, description: 'Jump if NOT EQUAL (alias for JNZ)', cycles: 2 },
    LOOP:   { code: 0x4F, category: 'control', operands: 1, description: 'Decrement R4, jump if non-zero', cycles: 2 },

    // ── Stack ──
    PUSH:   { code: 0x50, category: 'stack', operands: 1, description: 'Push register onto stack', cycles: 1 },
    POP:    { code: 0x51, category: 'stack', operands: 1, description: 'Pop top of stack into register', cycles: 1 },
    PUSHA:  { code: 0x52, category: 'stack', operands: 0, description: 'Push all general-purpose registers', cycles: 8 },
    POPA:   { code: 0x53, category: 'stack', operands: 0, description: 'Pop all general-purpose registers', cycles: 8 },
    PUSHF:  { code: 0x54, category: 'stack', operands: 0, description: 'Push FLAGS register', cycles: 1 },
    POPF:   { code: 0x55, category: 'stack', operands: 0, description: 'Pop FLAGS register', cycles: 1 },
    ENTER:  { code: 0x56, category: 'stack', operands: 2, description: 'Build stack frame (allocate locals)', cycles: 3 },
    LEAVE:  { code: 0x57, category: 'stack', operands: 0, description: 'Destroy stack frame', cycles: 2 },

    // ── Memory ──
    LOAD:   { code: 0x60, category: 'memory', operands: 2, description: 'Load value from memory address', cycles: 2 },
    STORE:  { code: 0x61, category: 'memory', operands: 2, description: 'Store value to memory address', cycles: 2 },
    LEA:    { code: 0x62, category: 'memory', operands: 2, description: 'Load effective address (no memory access)', cycles: 1 },
    LODB:   { code: 0x63, category: 'memory', operands: 2, description: 'Load byte from memory', cycles: 2 },
    STOB:   { code: 0x64, category: 'memory', operands: 2, description: 'Store byte to memory', cycles: 2 },
    LODW:   { code: 0x65, category: 'memory', operands: 2, description: 'Load word (2 bytes) from memory', cycles: 2 },
    STOW:   { code: 0x66, category: 'memory', operands: 2, description: 'Store word (2 bytes) to memory', cycles: 2 },
    LODD:   { code: 0x67, category: 'memory', operands: 2, description: 'Load double-word (4 bytes) from memory', cycles: 2 },
    STOD:   { code: 0x68, category: 'memory', operands: 2, description: 'Store double-word (4 bytes) to memory', cycles: 2 },

    // ── Subroutine ──
    CALL:   { code: 0x70, category: 'subroutine', operands: 1, description: 'Call subroutine (push return address, jump)', cycles: 3 },
    RET:    { code: 0x71, category: 'subroutine', operands: 0, description: 'Return from subroutine (pop PC)', cycles: 2 },
    SYSCALL: { code: 0x72, category: 'subroutine', operands: 1, description: 'System call (trap to kernel)', cycles: 10 },
    TRAP:   { code: 0x73, category: 'subroutine', operands: 1, description: 'Software trap / interrupt', cycles: 10 },
    IRET:   { code: 0x74, category: 'subroutine', operands: 0, description: 'Return from interrupt', cycles: 5 },

    // ── Special ──
    HALT:   { code: 0x80, category: 'special', operands: 0, description: 'Halt the processor', cycles: 1 },
    NOP:    { code: 0x81, category: 'special', operands: 0, description: 'No operation (1 cycle delay)', cycles: 1 },
    BRK:    { code: 0x82, category: 'special', operands: 0, description: 'Breakpoint (debug trap)', cycles: 1 },
    DBG:    { code: 0x83, category: 'special', operands: 1, description: 'Debug output (write register to debug log)', cycles: 2 },
    YIELD:  { code: 0x84, category: 'special', operands: 0, description: 'Yield to scheduler (cooperative multitasking)', cycles: 5 },
    FLUSH:  { code: 0x85, category: 'special', operands: 0, description: 'Flush instruction and data caches', cycles: 20 },
    SYNC:   { code: 0x86, category: 'special', operands: 0, description: 'Memory fence / synchronization barrier', cycles: 3 },
    CACHE:  { code: 0x87, category: 'special', operands: 2, description: 'Cache control (prefetch, invalidate)', cycles: 5 },
    CPY:    { code: 0x88, category: 'special', operands: 3, description: 'Memory-to-memory copy (len bytes)', cycles: 4 },
    FILL:   { code: 0x89, category: 'special', operands: 3, description: 'Fill memory region with value', cycles: 4 },
    CRC32:  { code: 0x8A, category: 'special', operands: 2, description: 'Compute CRC32 checksum', cycles: 8 },
    HASH:   { code: 0x8B, category: 'special', operands: 2, description: 'Compute hash of memory region', cycles: 12 },
  }),

  // -----------------------------------------------------------------------
  // Addressing Modes
  // -----------------------------------------------------------------------
  addressing_modes: Object.freeze({
    immediate: {
      syntax: '#value',
      description: 'The operand value is embedded directly in the instruction',
      examples: ['MOV R0, #42', 'ADD R1, #10'],
    },
    register: {
      syntax: 'Rn',
      description: 'The operand is a register',
      examples: ['MOV R0, R1', 'ADD R2, R3'],
    },
    direct: {
      syntax: '[address]',
      description: 'The operand is a memory address specified directly',
      examples: ['LOAD R0, [0x1000]', 'STORE R1, [0x2000]'],
    },
    indirect: {
      syntax: '[Rn]',
      description: 'The effective address is stored in a register (pointer dereference)',
      examples: ['LOAD R0, [R2]', 'STORE R1, [FP+8]'],
    },
    indexed: {
      syntax: '[Rn + offset]',
      description: 'Register plus a fixed offset — array/struct access pattern',
      examples: ['LOAD R0, [R3 + 16]', 'STORE R1, [FP - 4]'],
    },
    stack: {
      syntax: '[SP+n] or [FP+n]',
      description: 'Stack-relative addressing for local variables and parameters',
      examples: ['LOAD R0, [FP-8]', 'STORE R1, [SP+4]'],
    },
  }),

  // -----------------------------------------------------------------------
  // Flags
  // -----------------------------------------------------------------------
  flags: Object.freeze({
    ZERO:     { bit: 0, description: 'Set when the result of an operation is zero' },
    CARRY:    { bit: 1, description: 'Set on unsigned overflow (carry out of MSB)' },
    OVERFLOW: { bit: 2, description: 'Set on signed overflow' },
    NEGATIVE: { bit: 3, description: 'Set when the result is negative (MSB = 1)' },
    EQUAL:    { bit: 4, description: 'Set when CMP finds operands equal (alias of ZERO)' },
    LESS:     { bit: 5, description: 'Set when signed comparison finds first < second' },
    GREATER:  { bit: 6, description: 'Set when signed comparison finds first > second' },
    PARITY:   { bit: 7, description: 'Set when result has even parity' },
    INTERRUPT: { bit: 8, description: 'Interrupt enable flag' },
    USER:     { bit: 9, description: 'User/supervisor mode flag' },
  }),

  // -----------------------------------------------------------------------
  // Directives
  // -----------------------------------------------------------------------
  directives: Object.freeze({
    '.data':    { description: 'Begin data section — static data and constants', section: 'data' },
    '.text':    { description: 'Begin text section — executable code', section: 'text' },
    '.bss':     { description: 'Begin BSS section — uninitialized data', section: 'bss' },
    '.global':  { description: 'Export a symbol to the linker (global visibility)', section: 'meta' },
    '.local':   { description: 'Restrict a symbol to local file scope', section: 'meta' },
    '.extern':  { description: 'Declare an external symbol (defined elsewhere)', section: 'meta' },
    '.ascii':   { description: 'Define a null-terminated ASCII string', section: 'data' },
    '.asciz':   { description: 'Define a null-terminated string (same as .ascii)', section: 'data' },
    '.word':    { description: 'Define a 4-byte (32-bit) data word', section: 'data' },
    '.dword':   { description: 'Define an 8-byte (64-bit) data word', section: 'data' },
    '.byte':    { description: 'Define a 1-byte data value', section: 'data' },
    '.half':    { description: 'Define a 2-byte data value', section: 'data' },
    '.align':   { description: 'Align the next data/code to a power-of-2 boundary', section: 'meta' },
    '.space':   { description: 'Reserve N bytes of zero-initialized space', section: 'bss' },
    '.set':     { description: 'Set a symbolic constant value', section: 'meta' },
    '.macro':   { description: 'Begin a macro definition', section: 'meta' },
    '.endm':    { description: 'End a macro definition', section: 'meta' },
    '.include': { description: 'Include another file', section: 'meta' },
    '.section': { description: 'Begin a named section', section: 'meta' },
    '.type':    { description: 'Set the type of a symbol (function, object)', section: 'meta' },
    '.size':    { description: 'Set the size of a symbol', section: 'meta' },
  }),

  // -----------------------------------------------------------------------
  // Concepts — higher-level FLUX thinking terms
  // -----------------------------------------------------------------------
  concepts: Object.freeze({
    convergence: {
      description: 'When multiple implementations in different languages compile down to the same FLUX ISA bytecode sequence — the ultimate proof of semantic equivalence',
      category: 'verification',
    },
    divergence: {
      description: 'When two supposedly equivalent implementations produce different ISA patterns, revealing a semantic gap or bug',
      category: 'verification',
    },
    trace: {
      description: 'An execution trace — a linear sequence of opcodes representing one complete program execution path',
      category: 'execution',
    },
    snapshot: {
      description: 'A point-in-time capture of all register values and memory state — a frozen moment in the trace',
      category: 'execution',
    },
    checkpoint: {
      description: 'A named snapshot that can be restored, enabling rollback of execution state',
      category: 'execution',
    },
    rollback: {
      description: 'Restoring a previous checkpoint — undoing execution to a known-good state',
      category: 'execution',
    },
    opcode_budget: {
      description: 'The maximum number of opcodes allowed for a solution — encourages minimal, elegant implementations',
      category: 'metrics',
    },
    cognitive_complexity: {
      description: 'A metric measuring the mental effort to understand an opcode sequence, factoring in branching depth, register pressure, and control flow entropy',
      category: 'metrics',
    },
    register_pressure: {
      description: 'The number of live registers at any point — high pressure suggests complex data flow',
      category: 'metrics',
    },
    isa_equivalence: {
      description: 'The property of two code sequences having identical ISA-level behavior despite different source representations',
      category: 'verification',
    },
    flux_bytecode: {
      description: 'The intermediate representation of code compiled to FLUX ISA — the universal language layer',
      category: 'representation',
    },
    fleet_pattern: {
      description: 'A distributed computing pattern expressed in FLUX ISA — how agents coordinate at the machine level',
      category: 'architecture',
    },
    opcode_reduction: {
      description: 'The process of simplifying an opcode sequence while preserving behavior — FLUX-native optimization',
      category: 'optimization',
    },
    zero_copy: {
      description: 'A pattern where data moves between components without intermediate copies — tracked via STORE/LOAD minimization',
      category: 'optimization',
    },
    hot_path: {
      description: 'The most frequently executed trace in a program — the primary target for ISA-level optimization',
      category: 'analysis',
    },
    cold_path: {
      description: 'Rarely executed code paths — candidates for de-prioritization or lazy loading',
      category: 'analysis',
    },
  }),
});

// ---------------------------------------------------------------------------
// Lookup Functions
// ---------------------------------------------------------------------------

/**
 * Find a term's definition across all vocabulary categories.
 *
 * @param {string} term — The term to look up (case-sensitive)
 * @returns {{ found: boolean, category: string, term: string, definition: object } | null}
 */
export function lookup(term) {
  const upperTerm = term.toUpperCase();

  // Check registers
  if (fluxVocabulary.registers[upperTerm]) {
    return {
      found: true,
      category: 'registers',
      term: upperTerm,
      definition: fluxVocabulary.registers[upperTerm],
    };
  }

  // Check opcodes
  if (fluxVocabulary.opcodes[upperTerm]) {
    return {
      found: true,
      category: 'opcodes',
      term: upperTerm,
      definition: fluxVocabulary.opcodes[upperTerm],
    };
  }

  // Check flags
  if (fluxVocabulary.flags[upperTerm]) {
    return {
      found: true,
      category: 'flags',
      term: upperTerm,
      definition: fluxVocabulary.flags[upperTerm],
    };
  }

  // Check directives (case-sensitive)
  if (fluxVocabulary.directives[term]) {
    return {
      found: true,
      category: 'directives',
      term,
      definition: fluxVocabulary.directives[term],
    };
  }

  // Check addressing modes (case-sensitive)
  if (fluxVocabulary.addressing_modes[term]) {
    return {
      found: true,
      category: 'addressing_modes',
      term,
      definition: fluxVocabulary.addressing_modes[term],
    };
  }

  // Check concepts (case-sensitive)
  if (fluxVocabulary.concepts[term]) {
    return {
      found: true,
      category: 'concepts',
      term,
      definition: fluxVocabulary.concepts[term],
    };
  }

  return null;
}

/**
 * Search within a vocabulary category using a glob-like pattern.
 *
 * @param {string} category — Category name (registers, opcodes, flags, directives, addressing_modes, concepts)
 * @param {string} pattern — Search pattern (substring match, case-insensitive)
 * @returns {Array<{term: string, definition: object}>}
 */
export function search(category, pattern) {
  const cat = fluxVocabulary[category];
  if (!cat) {
    return [];
  }

  const lowerPattern = pattern.toLowerCase();
  return Object.entries(cat)
    .filter(([key, val]) => {
      const descLower = val.description.toLowerCase();
      return key.toLowerCase().includes(lowerPattern) || descLower.includes(lowerPattern);
    })
    .map(([key, val]) => ({ term: key, definition: val }));
}

/**
 * Format an opcode instruction for display.
 *
 * @param {string} opcode — Opcode mnemonic
 * @param {Array<string>} [operands] — Operand list
 * @returns {string} Formatted instruction string, e.g. "MOV R0, #42"
 */
export function formatOpcode(opcode, operands = []) {
  const upperOp = opcode.toUpperCase();
  const info = fluxVocabulary.opcodes[upperOp];

  if (!info) {
    // Unknown opcode — just format as-is
    return `${upperOp} ${operands.join(', ')}`.trim();
  }

  // Format with proper spacing
  const opStr = operands.join(', ');
  // Pad opcode to 6 chars for alignment
  const padded = upperOp.padEnd(6);
  return `${padded} ${opStr}`;
}

/**
 * Get all opcodes in a given category.
 * @param {string} category — Opcode category (data, arith, bitwise, compare, control, stack, memory, subroutine, special)
 * @returns {Array<{opcode: string, info: object}>}
 */
export function getOpcodesByCategory(category) {
  return Object.entries(fluxVocabulary.opcodes)
    .filter(([, info]) => info.category === category)
    .map(([opcode, info]) => ({ opcode, info }));
}

/**
 * Get the total instruction count for the FLUX ISA.
 * @returns {number}
 */
export function getOpcodeCount() {
  return Object.keys(fluxVocabulary.opcodes).length;
}

/**
 * Get a summary of all vocabulary categories and their sizes.
 * @returns {Record<string, number>}
 */
export function getVocabularySummary() {
  return {
    registers: Object.keys(fluxVocabulary.registers).length,
    opcodes: Object.keys(fluxVocabulary.opcodes).length,
    addressing_modes: Object.keys(fluxVocabulary.addressing_modes).length,
    flags: Object.keys(fluxVocabulary.flags).length,
    directives: Object.keys(fluxVocabulary.directives).length,
    concepts: Object.keys(fluxVocabulary.concepts).length,
  };
}

export default {
  fluxVocabulary,
  lookup,
  search,
  formatOpcode,
  getOpcodesByCategory,
  getOpcodeCount,
  getVocabularySummary,
};
