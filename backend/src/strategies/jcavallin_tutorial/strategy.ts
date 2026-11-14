// Class definition


import { BaseStrategy } from "../base/strategy";
import type { EvaluationContext } from "../base/strategy";
import type { BaseStrategyConfig, StrategySignal, StrategyType } from "../../types/strategy";
import type { MarketEventKind } from "../../types/market";

export interface TutorialConfig extends BaseStrategyConfig {
  type: "tutorial";
}

// Created object class that is created by the engine to run the strategy
// Allows you to run multiple copies of the same strategy
export class TutorialStrategy extends BaseStrategy {
    readonly type: StrategyType = "tutorial";
    static readonly VERSION = 1;
    readonly version = TutorialStrategy.VERSION;
    // Includes the data sources it uses to calculate signals. Can also include quotes and trades
    readonly triggers: readonly MarketEventKind[] = ["bar"]; 

    constructor(readonly myConfig: TutorialConfig) {
        super(myConfig);
    }

    evaluate(_context: EvaluationContext): StrategySignal | null {
        return null; 
    }


}


