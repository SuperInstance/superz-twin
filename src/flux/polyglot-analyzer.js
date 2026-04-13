/**
 * @module flux/polyglot-analyzer
 * @description Polyglot code analysis — Super Z's cross-language fluency.
 *
 * Super Z reads code across Python, Go, JavaScript, TypeScript, Rust, and C
 * with native understanding of each language's idioms, performance profiles,
 * and patterns. This module provides analysis, comparison, optimization,
 * and cross-language translation capabilities.
 */

import { FluxNative } from './flux-native.js';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Language Definitions
// ---------------------------------------------------------------------------

/**
 * Language metadata and configuration.
 * @type {Record<string, object>}
 */
export const supportedLanguages = {
  python: {
    name: 'Python',
    extensions: ['.py', '.pyw'],
    shebang: '#!',
    commentStyle: 'hash',
    typeSystem: 'dynamic',
    compiled: false,
    paradigms: ['procedural', 'object-oriented', 'functional'],
    strengths: ['rapid development', 'data manipulation', 'ML/AI', 'scripting'],
    weaknesses: ['performance', 'GIL limitations', 'runtime errors', 'distribution'],
    patterns: {
      iteration: 'for x in iterable / list comprehension',
      errorHandling: 'try/except/else/finally',
      concurrency: 'asyncio, threading, multiprocessing',
      modules: 'import / from ... import',
      typing: 'Optional[int], List[str], Protocol',
      idioms: ['list comprehension', 'generator expression', 'context manager', 'decorator', 'dataclass'],
    },
  },
  go: {
    name: 'Go',
    extensions: ['.go'],
    shebang: '//',
    commentStyle: 'slash',
    typeSystem: 'static',
    compiled: true,
    paradigms: ['procedural', 'concurrent'],
    strengths: ['concurrency', 'performance', 'simplicity', 'fast compilation', 'deployability'],
    weaknesses: ['error handling verbosity', 'generics immaturity', 'no inheritance'],
    patterns: {
      iteration: 'for range / for init; cond; post',
      errorHandling: 'if err != nil { return err }',
      concurrency: 'goroutines, channels, select',
      modules: 'import "package"',
      typing: 'struct, interface{}, type alias',
      idioms: ['goroutine', 'channel', 'defer', 'interface satisfaction', 'composition over inheritance'],
    },
  },
  javascript: {
    name: 'JavaScript',
    extensions: ['.js', '.mjs', '.cjs'],
    shebang: '//',
    commentStyle: 'slash',
    typeSystem: 'dynamic',
    compiled: false,
    paradigms: ['event-driven', 'prototype-based', 'functional'],
    strengths: ['ubiquity', 'async/event-driven', 'ecosystem (npm)', 'full-stack'],
    weaknesses: ['type safety', 'callback complexity', 'implicit coercions', 'module fragmentation'],
    patterns: {
      iteration: 'for...of, .forEach, .map, .filter, .reduce',
      errorHandling: 'try/catch/finally, .catch(), async/await',
      concurrency: 'Promise, async/await, Worker threads',
      modules: 'import/export, require()',
      typing: 'JSDoc, TypeScript-compatible',
      idioms: ['destructuring', 'spread operator', 'arrow functions', 'optional chaining', 'template literals'],
    },
  },
  typescript: {
    name: 'TypeScript',
    extensions: ['.ts', '.tsx'],
    shebang: '//',
    commentStyle: 'slash',
    typeSystem: 'static',
    compiled: true,
    paradigms: ['object-oriented', 'functional', 'event-driven'],
    strengths: ['type safety', 'IDE support', 'refactoring', 'large-scale apps'],
    weaknesses: ['compilation step', 'type complexity', 'build tooling'],
    patterns: {
      iteration: 'Same as JavaScript + typed iterators',
      errorHandling: 'try/catch, Result<T, E> pattern, never',
      concurrency: 'Promise<T>, async/await, typed workers',
      modules: 'import/export, namespace, triple-slash',
      typing: 'interface, type, generics, union, intersection',
      idioms: ['discriminated unions', 'type guards', 'mapped types', 'conditional types', 'decorators'],
    },
  },
  rust: {
    name: 'Rust',
    extensions: ['.rs'],
    shebang: '//',
    commentStyle: 'slash',
    typeSystem: 'static',
    compiled: true,
    paradigms: ['systems', 'functional', 'concurrent'],
    strengths: ['memory safety', 'performance', 'zero-cost abstractions', 'fearless concurrency'],
    weaknesses: ['steep learning curve', 'compile times', 'borrow checker friction'],
    patterns: {
      iteration: 'for x in iterable, .iter(), .into_iter()',
      errorHandling: 'Result<T, E>, Option<T>, ?, unwrap()',
      concurrency: 'std::thread, async/await, tokio, channels',
      modules: 'mod, use, crate',
      typing: 'struct, enum, trait, impl, generics, lifetimes',
      idioms: ['ownership', 'borrowing', 'pattern matching', 'iterator chains', 'trait objects'],
    },
  },
  c: {
    name: 'C',
    extensions: ['.c', '.h'],
    shebang: '/*',
    commentStyle: 'slash_block',
    typeSystem: 'static',
    compiled: true,
    paradigms: ['procedural', 'systems'],
    strengths: ['performance', 'low-level control', 'portability', 'ecosystem'],
    weaknesses: ['memory safety', 'manual management', 'error handling', 'build complexity'],
    patterns: {
      iteration: 'for(;;), while(), do...while',
      errorHandling: 'return codes, errno, goto cleanup',
      concurrency: 'pthreads, fork, shared memory',
      modules: '#include, static, extern',
      typing: 'struct, enum, union, typedef, function pointers',
      idioms: ['RAII-like cleanup', 'function pointer tables', 'opaque pointers', 'X macros', 'flexible array members'],
    },
  },
};

// ---------------------------------------------------------------------------
// Language-Specific Pattern Detection Rules
// ---------------------------------------------------------------------------

/**
 * Regex-based pattern detectors per language.
 * @type {Record<string, Array<{pattern: RegExp, name: string, category: string}>>}
 */
const PATTERN_RULES = {
  python: [
    { pattern: /\bfor\s+\w+\s+in\s+.*:/, name: 'for_in_loop', category: 'iteration' },
    { pattern: /\bwhile\s+.*:/, name: 'while_loop', category: 'iteration' },
    { pattern: /\[.*\bfor\b.*\bfor\b.*\]/, name: 'nested_comprehension', category: 'functional' },
    { pattern: /\[.*\bfor\b.*\]/, name: 'list_comprehension', category: 'functional' },
    { pattern: /\(.*\bfor\b.*\)/, name: 'generator_expression', category: 'functional' },
    { pattern: /\btry\s*:/, name: 'try_except', category: 'error_handling' },
    { pattern: /@\w+/g, name: 'decorator', category: 'metaprogramming' },
    { pattern: /\bclass\s+\w+.*:/, name: 'class_definition', category: 'oop' },
    { pattern: /\bdef\s+\w+\s*\(.*\).*:/, name: 'function_definition', category: 'procedural' },
    { pattern: /\basync\s+def\b/, name: 'async_function', category: 'concurrency' },
    { pattern: /\bawait\b/, name: 'await_expression', category: 'concurrency' },
    { pattern: /\bwith\s+\w+\s+as\s+\w+\s*:/, name: 'context_manager', category: 'resource_management' },
    { pattern: /from\s+typing\s+import/, name: 'type_annotation', category: 'typing' },
    { pattern: /->\s*\w+/, name: 'return_type_hint', category: 'typing' },
  ],
  go: [
    { pattern: /\bfor\s+range\b/, name: 'range_loop', category: 'iteration' },
    { pattern: /\bfor\s+.*;.*;.*\{/, name: 'c_style_loop', category: 'iteration' },
    { pattern: /\bif\s+err\s*!=\s*nil\b/, name: 'error_check', category: 'error_handling' },
    { pattern: /\bgo\s+func\b/, name: 'goroutine_launch', category: 'concurrency' },
    { pattern: /\bgo\s+\w+\(/, name: 'goroutine_call', category: 'concurrency' },
    { pattern: /<-/, name: 'channel_operation', category: 'concurrency' },
    { pattern: /\bselect\s*\{/, name: 'select_statement', category: 'concurrency' },
    { pattern: /\bdefer\b/, name: 'defer_statement', category: 'resource_management' },
    { pattern: /\btype\s+\w+\s+struct\b/, name: 'struct_definition', category: 'data' },
    { pattern: /\bfunc\s+\(.*\)\s+\w+\(/, name: 'method_definition', category: 'oop' },
    { pattern: /\binterface\s*\{/, name: 'interface_definition', category: 'abstraction' },
  ],
  javascript: [
    { pattern: /\bfor\s*\(.*\)/, name: 'for_loop', category: 'iteration' },
    { pattern: /\bfor\s*\(.*\bof\b/, name: 'for_of_loop', category: 'iteration' },
    { pattern: /\bfor\s*\(.*\bin\b/, name: 'for_in_loop', category: 'iteration' },
    { pattern: /\.forEach\s*\(/, name: 'foreach_method', category: 'functional' },
    { pattern: /\.map\s*\(/, name: 'map_method', category: 'functional' },
    { pattern: /\.filter\s*\(/, name: 'filter_method', category: 'functional' },
    { pattern: /\.reduce\s*\(/, name: 'reduce_method', category: 'functional' },
    { pattern: /\basync\s+function\b/, name: 'async_function', category: 'concurrency' },
    { pattern: /\bawait\b/, name: 'await_expression', category: 'concurrency' },
    { pattern: /\btry\s*\{/, name: 'try_catch', category: 'error_handling' },
    { pattern: /=>\s*{/, name: 'arrow_function', category: 'functional' },
    { pattern: /\.\.\./, name: 'spread_operator', category: 'syntax' },
    { pattern: /\?\./, name: 'optional_chaining', category: 'syntax' },
    { pattern: /\?\?/, name: 'nullish_coalescing', category: 'syntax' },
  ],
  typescript: [
    { pattern: /:\s*(string|number|boolean|void|any|never|unknown)\b/, name: 'type_annotation', category: 'typing' },
    { pattern: /<\w+(<[^>]+>)?>\s*\(/, name: 'generic_call', category: 'typing' },
    { pattern: /\binterface\s+\w+/, name: 'interface_definition', category: 'typing' },
    { pattern: /\btype\s+\w+\s*=/, name: 'type_alias', category: 'typing' },
    { pattern: /\btype\s+\w+\s*=/, name: 'discriminated_union', category: 'typing' },
    { pattern: /\bas\s+\w+/, name: 'type_assertion', category: 'typing' },
    { pattern: /\benum\s+\w+/, name: 'enum_definition', category: 'typing' },
    // Inherit JS patterns
    { pattern: /\.map\s*\(/, name: 'map_method', category: 'functional' },
    { pattern: /\.filter\s*\(/, name: 'filter_method', category: 'functional' },
    { pattern: /\basync\s+function\b/, name: 'async_function', category: 'concurrency' },
  ],
  rust: [
    { pattern: /\bfn\s+\w+.*->/, name: 'function_with_return_type', category: 'procedural' },
    { pattern: /\bfn\s+\w+.*Result\b/, name: 'result_returning_function', category: 'error_handling' },
    { pattern: /\bfn\s+\w+.*Option\b/, name: 'option_returning_function', category: 'error_handling' },
    { pattern: /\?\s*;/, name: 'try_operator', category: 'error_handling' },
    { pattern: /\.unwrap\(\)/, name: 'unwrap_call', category: 'error_handling' },
    { pattern: /\bmatch\s+.*\{/, name: 'match_expression', category: 'pattern_matching' },
    { pattern: /\bif\s+let\s+/, name: 'if_let', category: 'pattern_matching' },
    { pattern: /\bwhile\s+let\s+/, name: 'while_let', category: 'pattern_matching' },
    { pattern: /\bfor\s+\w+\s+in\b/, name: 'for_in_loop', category: 'iteration' },
    { pattern: /\.iter\(\)/, name: 'iterator', category: 'iteration' },
    { pattern: /\.map\s*\(/, name: 'iterator_map', category: 'functional' },
    { pattern: /\.filter\s*\(/, name: 'iterator_filter', category: 'functional' },
    { pattern: /\.collect\s*\(\)/, name: 'iterator_collect', category: 'iteration' },
    { pattern: /\bstruct\s+\w+/, name: 'struct_definition', category: 'data' },
    { pattern: /\benum\s+\w+/, name: 'enum_definition', category: 'data' },
    { pattern: /\bimpl\s+.*for\s+/, name: 'trait_implementation', category: 'abstraction' },
    { pattern: /\btrait\s+\w+/, name: 'trait_definition', category: 'abstraction' },
    { pattern: /\bmut\b/, name: 'mutable_binding', category: 'ownership' },
    { pattern: /&'?static\s/, name: 'static_lifetime', category: 'ownership' },
    { pattern: /\basync\s+fn\b/, name: 'async_function', category: 'concurrency' },
    { pattern: /\.await\b/, name: 'await_expression', category: 'concurrency' },
    { pattern: /\bunsafe\b/, name: 'unsafe_block', category: 'systems' },
  ],
  c: [
    { pattern: /\bfor\s*\(.*;.*;.*\)/, name: 'for_loop', category: 'iteration' },
    { pattern: /\bwhile\s*\(/, name: 'while_loop', category: 'iteration' },
    { pattern: /\bdo\s*\{/, name: 'do_while_loop', category: 'iteration' },
    { pattern: /\bif\s*\(.*\)\s*\{/, name: 'if_statement', category: 'control' },
    { pattern: /\bswitch\s*\(.*\)\s*\{/, name: 'switch_statement', category: 'control' },
    { pattern: /\bgoto\s+\w+/, name: 'goto_statement', category: 'control' },
    { pattern: /\bstruct\s+\w+\s*\{/, name: 'struct_definition', category: 'data' },
    { pattern: /\benum\s+\w+/, name: 'enum_definition', category: 'data' },
    { pattern: /\btypedef\s+/, name: 'typedef', category: 'typing' },
    { pattern: /\bvoid\s*\*\s*\w+/, name: 'opaque_pointer', category: 'systems' },
    { pattern: /\bmalloc\s*\(/, name: 'heap_allocation', category: 'memory' },
    { pattern: /\bfree\s*\(/, name: 'heap_deallocation', category: 'memory' },
    { pattern: /\bpthread_create\b/, name: 'thread_creation', category: 'concurrency' },
    { pattern: /\b#include\b/, name: 'preprocessor_include', category: 'preprocessor' },
    { pattern: /\b#define\b/, name: 'preprocessor_define', category: 'preprocessor' },
  ],
};

// ---------------------------------------------------------------------------
// Cross-Language Optimization Suggestions
// ---------------------------------------------------------------------------

/**
 * Suggestions for improving code based on patterns from other languages.
 * @type {Array<{from: string, to: string, pattern: string, suggestion: string}>}
 */
const CROSS_LANG_SUGGESTIONS = [
  {
    from: 'python',
    to: 'javascript',
    pattern: 'list_comprehension',
    suggestion: 'Consider using .map() or .filter() for functional iteration instead of manual loops',
  },
  {
    from: 'javascript',
    to: 'rust',
    pattern: 'try_catch',
    suggestion: 'Use Result<T, E> with the ? operator instead of try/catch for fallible operations',
  },
  {
    from: 'javascript',
    to: 'go',
    pattern: 'promise',
    suggestion: 'Use goroutines and channels instead of Promises for concurrent operations',
  },
  {
    from: 'go',
    to: 'rust',
    pattern: 'error_check',
    suggestion: 'Use Result<T, E> with ? operator to eliminate explicit error check boilerplate',
  },
  {
    from: 'c',
    to: 'rust',
    pattern: 'manual_memory',
    suggestion: 'Rust\'s ownership model eliminates manual malloc/free — consider using Vec, String, and Box',
  },
  {
    from: 'python',
    to: 'rust',
    pattern: 'try_except',
    suggestion: 'Replace try/except with Result<T, E> for explicit error handling at type level',
  },
  {
    from: 'javascript',
    to: 'typescript',
    pattern: 'dynamic_typing',
    suggestion: 'Add type annotations to function parameters and return types for better safety',
  },
  {
    from: 'go',
    to: 'python',
    pattern: 'verbose_error_handling',
    suggestion: 'Python\'s try/except allows more concise error handling without explicit if err != nil checks',
  },
  {
    from: 'c',
    to: 'go',
    pattern: 'manual_memory',
    suggestion: 'Go\'s garbage collector eliminates manual memory management — no need for malloc/free',
  },
  {
    from: 'rust',
    to: 'go',
    pattern: 'complex_types',
    suggestion: 'Go favors simplicity — consider whether trait objects and generics are necessary',
  },
];

// ---------------------------------------------------------------------------
// PolyglotAnalyzer
// ---------------------------------------------------------------------------

/**
 * Polyglot code analysis engine — Super Z's cross-language fluency.
 *
 * Provides deep analysis, cross-language comparison, pattern detection,
 * optimization suggestions, and rough code translation capabilities.
 */
export class PolyglotAnalyzer {
  /**
   * @param {object} [options]
   * @param {FluxNative} [options.fluxEngine] — Optional pre-configured FLUX engine
   */
  constructor({ fluxEngine } = {}) {
    this.flux = fluxEngine ?? new FluxNative();
  }

  // -----------------------------------------------------------------------
  // Core: Analyze a Single File
  // -----------------------------------------------------------------------

  /**
   * Analyze a source file for language-specific patterns, idioms, and metrics.
   *
   * @param {string} filePath — Path to the source file
   * @param {string} [language] — Override detected language
   * @returns {Promise<object>} Analysis result
   */
  async analyzeFile(filePath, language) {
    const code = await readFile(filePath, 'utf-8');
    const detectedLanguage = language ?? this._detectLanguage(filePath, code);
    const langInfo = supportedLanguages[detectedLanguage];

    if (!langInfo) {
      return {
        filePath,
        language: detectedLanguage,
        error: `Unsupported language: ${detectedLanguage}`,
        supportedLanguages: Object.keys(supportedLanguages),
      };
    }

    // Detect patterns
    const patterns = this._detectPatterns(code, detectedLanguage);

    // Compute metrics
    const metrics = this._computeMetrics(code, detectedLanguage);

    // Run FLUX bytecode analysis
    const fluxAnalysis = this.flux.analyzeBytecode(code, detectedLanguage);

    // Language-specific optimization suggestions
    const optimizations = this.languageSpecificOptimizations(code, detectedLanguage);

    return {
      filePath,
      language: detectedLanguage,
      languageInfo: {
        name: langInfo.name,
        typeSystem: langInfo.typeSystem,
        compiled: langInfo.compiled,
        paradigms: langInfo.paradigms,
      },
      patterns,
      metrics,
      fluxAnalysis,
      optimizations,
      summary: this._generateSummary(detectedLanguage, patterns, metrics, optimizations),
    };
  }

  // -----------------------------------------------------------------------
  // Core: Compare Implementations Across Languages
  // -----------------------------------------------------------------------

  /**
   * Compare the same logic implemented in multiple languages.
   * Uses FLUX ISA convergence as the definitive equivalence check.
   *
   * @param {Array<{path: string, language?: string}>} files — Files to compare
   * @returns {Promise<object>} Comparison result
   */
  async compareImplementations(files) {
    const analyses = [];

    // Analyze each file
    for (const file of files) {
      const analysis = await this.analyzeFile(file.path, file.language);
      analyses.push(analysis);
    }

    // Compute pairwise convergence
    const convergenceMatrix = [];
    for (let i = 0; i < analyses.length; i++) {
      for (let j = i + 1; j < analyses.length; j++) {
        const impl1 = analyses[i];
        const impl2 = analyses[j];

        const convergence = this.flux.isaConvergenceCheck(
          impl1.fluxAnalysis.decomposition.opcodes.map((o) => o.mnemonic).join(' '),
          impl2.fluxAnalysis.decomposition.opcodes.map((o) => o.mnemonic).join(' '),
          { lang1: impl1.language, lang2: impl2.language }
        );

        convergenceMatrix.push({
          pair: `${impl1.language} ↔ ${impl2.language}`,
          impl1: { language: impl1.language, path: impl1.filePath },
          impl2: { language: impl2.language, path: impl2.filePath },
          convergence: convergence.converges,
          confidence: convergence.confidence,
          divergence: convergence.metrics.totalDivergence,
        });
      }
    }

    const allConverge = convergenceMatrix.every((c) => c.convergence);
    const avgConfidence = convergenceMatrix.reduce((sum, c) => sum + c.confidence, 0) / convergenceMatrix.length;

    return {
      files: analyses.map((a) => ({ path: a.filePath, language: a.language })),
      pairwiseConvergence: convergenceMatrix,
      overallConvergence: allConverge,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      recommendations: [
        ...(allConverge
          ? ['All implementations converge to the same ISA — semantically equivalent']
          : ['Not all implementations converge — investigate divergent pairs']),
        ...convergenceMatrix
          .filter((c) => !c.converge)
          .map((c) => `Investigate ${c.pair} (divergence: ${Math.round(c.divergence * 100)}%)`),
      ],
    };
  }

  // -----------------------------------------------------------------------
  // Core: Identify Language Patterns
  // -----------------------------------------------------------------------

  /**
   * Detect idiomatic patterns in code for a given language.
   *
   * @param {string} code — Source code to analyze
   * @param {string} [language] — Language (auto-detected if not provided)
   * @returns {Array<{name: string, category: string, count: number, locations: number[]}>}
   */
  identifyLanguagePatterns(code, language) {
    const detectedLanguage = language ?? this._detectLanguage('', code);
    return this._detectPatterns(code, detectedLanguage);
  }

  // -----------------------------------------------------------------------
  // Core: Cross-Language Refactor Suggestions
  // -----------------------------------------------------------------------

  /**
   * Suggest improvements based on patterns and idioms from other languages.
   *
   * @param {string} pattern — Pattern name or code snippet
   * @returns {Array<{source: string, target: string, suggestion: string, relevance: number}>}
   */
  suggestCrossLanguageRefactors(pattern) {
    const lowerPattern = pattern.toLowerCase();
    const suggestions = [];

    for (const s of CROSS_LANG_SUGGESTIONS) {
      // Match by pattern name, language name, or keyword
      const matchesPattern = lowerPattern.includes(s.pattern.toLowerCase());
      const matchesSource = lowerPattern.includes(s.from.toLowerCase());
      const matchesTarget = lowerPattern.includes(s.to.toLowerCase());

      if (matchesPattern || matchesSource || matchesTarget) {
        let relevance = 1;
        if (matchesPattern) relevance = 3;
        else if (matchesSource && matchesTarget) relevance = 2;

        suggestions.push({
          source: s.from,
          target: s.to,
          pattern: s.pattern,
          suggestion: s.suggestion,
          relevance,
        });
      }
    }

    return suggestions.sort((a, b) => b.relevance - a.relevance);
  }

  // -----------------------------------------------------------------------
  // Core: Language-Specific Optimizations
  // -----------------------------------------------------------------------

  /**
   * Generate language-aware optimization suggestions.
   *
   * @param {string} code — Source code
   * @param {string} language — Language identifier
   * @returns {Array<{type: string, severity: string, message: string, suggestion?: string}>}
   */
  languageSpecificOptimizations(code, language) {
    const optimizations = [];
    const langInfo = supportedLanguages[language];
    if (!langInfo) return optimizations;

    const lines = code.split('\n');

    switch (language) {
      case 'python': {
        // Check for mutable default arguments
        const mutableDefaults = code.match(/def\s+\w+\(.*=\s*\[\]/);
        if (mutableDefaults) {
          optimizations.push({
            type: 'bug_risk',
            severity: 'high',
            message: 'Mutable default argument detected',
            suggestion: 'Use None as default and initialize inside the function: def f(x=None): x = x or []',
          });
        }

        // Check for bare except
        const bareExcept = code.match(/except\s*:/);
        if (bareExcept) {
          optimizations.push({
            type: 'antipattern',
            severity: 'medium',
            message: 'Bare except clause — catches all exceptions including KeyboardInterrupt',
            suggestion: 'Use specific exception types: except (ValueError, TypeError) as e:',
          });
        }

        // Check for long functions
        const funcDefs = code.match(/def\s+\w+/g);
        if (funcDefs && funcDefs.length > 0) {
          // Rough heuristic: if file is long and has few functions, functions may be too long
          if (lines.length > 200 && funcDefs.length < 3) {
            optimizations.push({
              type: 'complexity',
              severity: 'low',
              message: 'File contains long functions — consider breaking into smaller units',
            });
          }
        }
        break;
      }

      case 'go': {
        // Check for repeated error handling
        const errChecks = (code.match(/if\s+err\s*!=\s*nil/g) ?? []).length;
        if (errChecks > 5) {
          optimizations.push({
            type: 'verbosity',
            severity: 'low',
            message: `High error handling verbosity (${errChecks} explicit checks)`,
            suggestion: 'Consider wrapping repeated error patterns in a helper function',
          });
        }

        // Check for global variables
        const globalVars = code.match(/^var\s+\w+/gm);
        if (globalVars && globalVars.length > 3) {
          optimizations.push({
            type: 'design',
            severity: 'medium',
            message: 'Multiple global variables detected',
            suggestion: 'Consider encapsulating state in a struct with methods',
          });
        }
        break;
      }

      case 'javascript':
      case 'typescript': {
        // Check for callback hell
        const nestedCallbacks = code.match(/\}\s*,\s*function\s*\(/g);
        if (nestedCallbacks && nestedCallbacks.length > 2) {
          optimizations.push({
            type: 'antipattern',
            severity: 'medium',
            message: 'Nested callbacks detected (callback hell)',
            suggestion: 'Refactor to use async/await or Promise chains',
          });
        }

        // Check for var usage
        const varUsage = code.match(/\bvar\s+\w+/g);
        if (varUsage) {
          optimizations.push({
            type: 'modernization',
            severity: 'low',
            message: `Found ${varUsage.length} 'var' declarations`,
            suggestion: "Replace with 'const' or 'let' for block scoping",
          });
        }

        // Check for == instead of ===
        const looseEquals = code.match(/[^=!]==[^=]/g);
        if (looseEquals) {
          optimizations.push({
            type: 'correctness',
            severity: 'high',
            message: `Found ${looseEquals.length} loose equality comparisons (==)`,
            suggestion: 'Use strict equality (===) to avoid type coercion surprises',
          });
        }

        if (language === 'typescript') {
          // Check for any usage
          const anyUsage = code.match(/:\s*any\b/g);
          if (anyUsage) {
            optimizations.push({
              type: 'type_safety',
              severity: 'medium',
              message: `Found ${anyUsage.length} 'any' type annotations`,
              suggestion: "Replace with specific types or use 'unknown' for truly unknown values",
            });
          }
        }
        break;
      }

      case 'rust': {
        // Check for unwrap calls
        const unwraps = code.match(/\.unwrap\(\)/g);
        if (unwraps) {
          optimizations.push({
            type: 'error_handling',
            severity: 'medium',
            message: `Found ${unwraps.length} .unwrap() calls`,
            suggestion: 'Use ? operator or match to handle errors gracefully instead of panicking',
          });
        }

        // Check for unsafe blocks
        const unsafeBlocks = code.match(/\bunsafe\b/g);
        if (unsafeBlocks) {
          optimizations.push({
            type: 'safety',
            severity: 'high',
            message: `Found ${unsafeBlocks.length} unsafe blocks`,
            suggestion: 'Minimize unsafe usage — audit each block for memory safety guarantees',
          });
        }

        // Check for clone() calls (potential performance issue)
        const clones = code.match(/\.clone\(\)/g);
        if (clones && clones.length > 3) {
          optimizations.push({
            type: 'performance',
            severity: 'low',
            message: `Found ${clones.length} .clone() calls — consider borrowing instead`,
            suggestion: 'Use references (&T) or Cow<T> instead of cloning when ownership transfer is not needed',
          });
        }
        break;
      }

      case 'c': {
        // Check for unchecked returns
        const uncheckedMallocs = code.match(/malloc\s*\([^)]*\)\s*;/);
        if (uncheckedMallocs) {
          optimizations.push({
            type: 'safety',
            severity: 'high',
            message: 'Unchecked malloc() return — potential null pointer dereference',
            suggestion: 'Always check malloc return: if (!ptr) { handle_error(); }',
          });
        }

        // Check for buffer operations without size checks
        const strcpyUsage = code.match(/strcpy\s*\(/);
        if (strcpyUsage) {
          optimizations.push({
            type: 'security',
            severity: 'critical',
            message: 'strcpy() detected — vulnerable to buffer overflow',
            suggestion: 'Use strncpy() or better yet, snprintf() with explicit size limits',
          });
        }

        // Check for printf format string issues
        const printfUserInput = code.match(/printf\s*\(\s*[^"]*\)/);
        if (printfUserInput) {
          optimizations.push({
            type: 'security',
            severity: 'high',
            message: 'printf with non-constant format string — potential format string vulnerability',
            suggestion: 'Always use a constant format string: printf("%s", variable)',
          });
        }
        break;
      }
    }

    return optimizations;
  }

  // -----------------------------------------------------------------------
  // Core: Generate Equivalent Code
  // -----------------------------------------------------------------------

  /**
   * Generate a rough equivalent of code in another language.
   * This is a best-effort translation — not production-quality but
   * useful for understanding and comparison purposes.
   *
   * @param {string} code — Source code
   * @param {string} fromLang — Source language
   * @param {string} toLang — Target language
   * @returns {{code: string, confidence: string, notes: string[], mapping: object}}
   */
  generateEquivalent(code, fromLang, toLang) {
    const srcInfo = supportedLanguages[fromLang];
    const dstInfo = supportedLanguages[toLang];

    if (!srcInfo || !dstInfo) {
      return {
        code: '',
        confidence: 'none',
        notes: [`Unsupported language: ${!srcInfo ? fromLang : toLang}`],
        mapping: {},
      };
    }

    if (fromLang === toLang) {
      return {
        code,
        confidence: 'exact',
        notes: ['Source and target languages are the same'],
        mapping: {},
      };
    }

    const lines = code.trim().split('\n');
    const translated = [];
    const notes = [];
    const mapping = { patterns: [], conversions: [] };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
        // Preserve comments
        translated.push(this._translateComment(trimmed, fromLang, toLang));
        continue;
      }

      const translation = this._translateLine(trimmed, fromLang, toLang, notes, mapping);
      translated.push(translation);
    }

    return {
      code: translated.join('\n'),
      confidence: 'approximate',
      notes: [
        'This is a rough translation — manual review required',
        ...notes,
      ],
      mapping,
    };
  }

  // -----------------------------------------------------------------------
  // Internal: Language Detection
  // -----------------------------------------------------------------------

  /**
   * Detect language from file extension or code patterns.
   * @param {string} filePath
   * @param {string} code
   * @returns {string}
   * @private
   */
  _detectLanguage(filePath, code) {
    // Try by extension first
    const ext = filePath.split('.').pop()?.toLowerCase();
    const extMap = {
      py: 'python', pyw: 'python',
      go: 'go',
      js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      rs: 'rust',
      c: 'c', h: 'c',
    };

    if (ext && extMap[ext]) return extMap[ext];

    // Fallback: detect from code patterns
    if (code.match(/\bdef\s+\w+\s*\(.*\).*:/)) return 'python';
    if (code.match(/\bpackage\s+\w+/)) return 'go';
    if (code.match(/\bfn\s+\w+\s*</) || code.match(/\.unwrap\(\)/)) return 'rust';
    if (code.match(/:\s*(string|number|boolean)\b/) || code.match(/\binterface\s+\w+.*\{/)) return 'typescript';
    if (code.match(/\bfunc\s+\w+/) || code.match(/:\s*=/)) return 'go';
    if (code.match(/\b#include\b/)) return 'c';
    if (code.match(/\bfunction\b|\bconst\b|\blet\b|\bvar\b/)) return 'javascript';

    return 'unknown';
  }

  // -----------------------------------------------------------------------
  // Internal: Pattern Detection
  // -----------------------------------------------------------------------

  /**
   * Detect patterns using regex rules for a given language.
   * @param {string} code
   * @param {string} language
   * @returns {Array<{name: string, category: string, count: number, locations: number[]}>}
   * @private
   */
  _detectPatterns(code, language) {
    const rules = PATTERN_RULES[language];
    if (!rules) return [];

    const patterns = [];

    for (const rule of rules) {
      const matches = code.match(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? 'g' : undefined));
      if (matches && matches.length > 0) {
        // Find line numbers
        const locations = [];
        const codeLines = code.split('\n');
        for (let i = 0; i < codeLines.length; i++) {
          if (rule.pattern.test(codeLines[i])) {
            locations.push(i + 1); // 1-indexed
          }
          // Reset lastIndex for global regex
          rule.pattern.lastIndex = 0;
        }

        patterns.push({
          name: rule.name,
          category: rule.category,
          count: matches.length,
          locations,
        });
      }
    }

    return patterns.sort((a, b) => b.count - a.count);
  }

  // -----------------------------------------------------------------------
  // Internal: Code Metrics
  // -----------------------------------------------------------------------

  /**
   * Compute basic code metrics.
   * @param {string} code
   * @param {string} language
   * @returns {object}
   * @private
   */
  _computeMetrics(code, language) {
    const lines = code.split('\n');
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    const commentLines = lines.filter((l) =>
      l.trim().startsWith('//') || l.trim().startsWith('#') || l.trim().startsWith('/*') || l.trim().startsWith('*')
    );

    // Rough function/class count
    const funcCount = (code.match(/\b(def|fn|func|function)\s+\w+/g) ?? []).length;
    const classCount = (code.match(/\b(class|struct|interface)\s+\w+/g) ?? []).length;

    // Lines of code (excluding comments and blank)
    const loc = nonEmptyLines.length - commentLines.length;

    // Cyclomatic complexity (rough: count branching keywords)
    const branchKeywords = code.match(/\b(if|else|elif|for|while|case|catch)\b/g) ?? [];

    return {
      totalLines: lines.length,
      loc,
      commentLines: commentLines.length,
      commentRatio: loc > 0 ? Math.round((commentLines.length / loc) * 100) / 100 : 0,
      functionCount: funcCount,
      classCount: classCount,
      branchCount: branchKeywords.length,
      roughCyclomatic: 1 + branchKeywords.length,
      avgLinesPerFunction: funcCount > 0 ? Math.round(loc / funcCount) : 0,
    };
  }

  // -----------------------------------------------------------------------
  // Internal: Line Translation (Rough Equivalent)
  // -----------------------------------------------------------------------

  /**
   * Translate a single line of code between languages (rough approximation).
   * @param {string} line
   * @param {string} from
   * @param {string} to
   * @param {string[]} notes
   * @param {object} mapping
   * @returns {string}
   * @private
   */
  _translateLine(line, from, to, notes, mapping) {
    // Variable declarations
    if (line.match(/^(const|let|var)\s+(\w+)\s*=/)) {
      const varMatch = line.match(/^(const|let|var)\s+(\w+)\s*=\s*(.+)$/);
      if (varMatch) {
        const [, , name, value] = varMatch;
        const mapping_ = this._mapVarDecl(name, value, from, to, notes);
        mapping.conversions.push({ type: 'var_decl', from, to });
        return mapping_;
      }
    }

    // Python-specific
    if (from === 'python') {
      if (line.match(/^def\s+/)) {
        return this._mapFunctionDef(line, 'python', to, notes, mapping);
      }
      if (line.match(/^(if|elif|else|for|while|with|try|except|finally|class)\b/)) {
        return this._mapControlFlow(line, 'python', to, notes);
      }
      if (line.match(/^import\b/)) {
        return this._mapImport(line, 'python', to, notes);
      }
      return `// TODO: translate: ${line}`;
    }

    // Generic fallback
    return `// TODO: translate from ${from} to ${to}: ${line}`;
  }

  /**
   * Map variable declarations between languages.
   * @private
   */
  _mapVarDecl(name, value, from, to, notes) {
    const templates = {
      python: { prefix: '', suffix: '' },
      go: { prefix: `${name} := `, suffix: '' },
      javascript: { prefix: `const ${name} = `, suffix: ';' },
      typescript: { prefix: `const ${name}: unknown = `, suffix: ';' },
      rust: { prefix: `let ${name}: _ = `, suffix: ';' },
      c: { prefix: `auto ${name} = `, suffix: ';' },
    };

    const tmpl = templates[to] ?? templates.javascript;
    notes.push(`Variable '${name}' mapped from ${from} to ${to} — type may need manual adjustment`);
    return `${tmpl.prefix}${value}${tmpl.suffix}`;
  }

  /**
   * Map function definitions.
   * @private
   */
  _mapFunctionDef(line, from, to, notes, mapping) {
    const funcMatch = line.match(/def\s+(\w+)\s*\(([^)]*)\)\s*(->\s*\w+)?\s*:/);
    if (!funcMatch) return `// TODO: ${line}`;

    const [, name, params, retType] = funcMatch;
    const cleanParams = params || '';
    mapping.patterns.push({ type: 'function_definition', from, to });

    switch (to) {
      case 'go':
        return `func ${name}(${cleanParams}) ${retType ? this._mapReturnType(retType, 'python', 'go') : ''} {`;
      case 'rust':
        return `fn ${name}(${cleanParams}) ${retType ? this._mapReturnType(retType, 'python', 'rust') : '()'} {`;
      case 'javascript':
        notes.push(`Function '${name}' converted to JavaScript — types are lost`);
        return `function ${name}(${cleanParams}) {`;
      case 'typescript':
        return `function ${name}(${cleanParams}): ${retType ? this._mapReturnType(retType, 'python', 'typescript') : 'void'} {`;
      case 'c':
        return `${retType ? this._mapReturnType(retType, 'python', 'c') : 'void'} ${name}(${cleanParams}) {`;
      default:
        return `// TODO: ${line}`;
    }
  }

  /**
   * Map control flow.
   * @private
   */
  _mapControlFlow(line, from, to, notes) {
    const kwMap = {
      python: { 'if': 'if', 'elif': 'else if', 'else': 'else', 'for': 'for', 'while': 'while', 'with': 'using', 'try': 'try', 'except': 'catch', 'finally': 'finally' },
    };

    const pyKw = line.match(/^(if|elif|else|for|while|with|try|except|finally|class)\b/)?.[1];
    if (!pyKw) return `// TODO: ${line}`;

    switch (to) {
      case 'go':
      case 'javascript':
      case 'typescript':
      case 'c': {
        const targetKw = pyKw === 'elif' ? 'else if' : pyKw;
        const condition = line.replace(/^(if|elif|else|for|while|with|try|except|finally|class)\b/, '').replace(/:\s*$/, '').trim();
        if (pyKw === 'else') return `${targetKw} {`;
        return `${targetKw} ${condition} {`;
      }
      case 'rust': {
        if (pyKw === 'for') {
          return `// for loop — Rust syntax differs: for x in iter {`;
        }
        if (pyKw === 'if') {
          const condition = line.replace(/^if\s+/, '').replace(/:\s*$/, '').trim();
          return `if ${condition} {`;
        }
        return `// TODO: ${line}`;
      }
      default:
        return `// TODO: ${line}`;
    }
  }

  /**
   * Map import statements.
   * @private
   */
  _mapImport(line, from, to, notes) {
    const modMatch = line.match(/^import\s+(\w+)(?:\s+as\s+(\w+))?/);
    if (!modMatch) return `// TODO: ${line}`;

    const [, mod, alias] = modMatch;
    notes.push(`Import '${mod}' mapped from Python to ${to} — module names differ across languages`);

    switch (to) {
      case 'go':
        return `import "${mod}"`;
      case 'javascript':
      case 'typescript':
        return `import ${alias ?? mod} from '${mod}';`;
      case 'rust':
        return `use ${mod};`;
      case 'c':
        return `#include <${mod}.h>`;
      default:
        return `// TODO: ${line}`;
    }
  }

  /**
   * Map return types.
   * @private
   */
  _mapReturnType(retType, from, to) {
    const typeMap = {
      '-> int': { go: 'int', rust: 'i32', javascript: '', typescript: 'number', c: 'int' },
      '-> str': { go: 'string', rust: '&str', javascript: '', typescript: 'string', c: 'const char*' },
      '-> float': { go: 'float64', rust: 'f64', javascript: '', typescript: 'number', c: 'double' },
      '-> bool': { go: 'bool', rust: 'bool', javascript: '', typescript: 'boolean', c: '_Bool' },
      '-> list': { go: '[]T', rust: 'Vec<T>', javascript: '', typescript: 'T[]', c: 'T*' },
      '-> dict': { go: 'map[K]V', rust: 'HashMap<K, V>', javascript: '', typescript: 'Record<K, V>', c: 'T*' },
      '-> None': { go: '', rust: '', javascript: '', typescript: 'void', c: 'void' },
    };

    const mapping = typeMap[retType.trim()] ?? { go: 'interface{}', rust: '()', javascript: '', typescript: 'unknown', c: 'void' };
    return mapping[to] ?? 'void';
  }

  /**
   * Translate a comment between languages.
   * @private
   */
  _translateComment(comment, from, to) {
    const trimmed = comment.trim();
    if (trimmed.startsWith('#')) {
      if (['javascript', 'typescript', 'go', 'rust', 'c'].includes(to)) {
        return `// ${trimmed.slice(1).trim()}`;
      }
      return comment;
    }
    if (trimmed.startsWith('//')) {
      if (to === 'python') {
        return `# ${trimmed.slice(2).trim()}`;
      }
      return comment;
    }
    return comment;
  }

  // -----------------------------------------------------------------------
  // Internal: Summary Generation
  // -----------------------------------------------------------------------

  /**
   * Generate a human-readable analysis summary.
   * @private
   */
  _generateSummary(language, patterns, metrics, optimizations) {
    const parts = [];

    parts.push(`File analyzed: ${language} (${metrics.loc} LOC, ${metrics.commentLines} comment lines)`);

    if (patterns.length > 0) {
      const topPatterns = patterns.slice(0, 3);
      parts.push(`Top patterns: ${topPatterns.map((p) => `${p.name} (x${p.count})`).join(', ')}`);
    }

    if (optimizations.length > 0) {
      const critical = optimizations.filter((o) => o.severity === 'critical' || o.severity === 'high');
      if (critical.length > 0) {
        parts.push(`${critical.length} high/critical optimization(s) found`);
      }
    }

    if (metrics.avgLinesPerFunction > 50) {
      parts.push('Functions appear long — consider decomposition');
    }

    return parts.join('. ') + '.';
  }
}

export default PolyglotAnalyzer;
