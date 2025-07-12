import * as chrono from "chrono-node";
import type { Moment } from "moment";

export interface ParsedMoment {
  moment: Moment;
}

// Use the built-in chrono parser with standard configuration
function createChrono(): any {
  return chrono;
}

class NLDParserImpl {
  private chrono = createChrono();

  getParsedDate(input: string): Date | null {
    // Use chrono with forward date parsing preference
    return this.chrono.parseDate(input, new Date(), { forwardDate: true });
  }

  /** Parse date using chrono-node natural language date parser */
  parseDate(input?: string): ParsedMoment | null {
    if (!input || !input.trim()) return null;

    try {
      const date = this.getParsedDate(input);
      if (!date) return null;
      
      const moment = (window as any).moment(date);
      return { moment };
    } catch (error) {
      console.warn("Failed to parse date:", input, error);
      return null;
    }
  }
}

// Export singleton instance to match expected API
export const NLDParser = new NLDParserImpl();
