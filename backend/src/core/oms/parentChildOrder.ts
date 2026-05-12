/**
 * core/oms/parentChildOrder.ts
 *
 * Tracks parent-child order relationships for algorithmic execution strategies
 * (TWAP, VWAP). A parent order represents the full intent; child orders are
 * the individual slices submitted to the market over time.
 *
 * Inputs:  OrderIntent, algo params (TwapParams | VwapParams), child fill events.
 * Outputs: Parent and child order state for algo execution tracking and monitoring.
 */

import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { UUID, ExecutionAlgoType } from "../../types/common";
import type { ParentOrder, ChildOrder, TwapParams, VwapParams } from "../../types/oms";
import type { OrderIntent } from "../../types/orders";
import type { Fill } from "../../types/orders";

export class ParentChildOrderTracker {
  private readonly _parents: Map<UUID, ParentOrder> = new Map();
  private readonly _children: Map<UUID, ChildOrder> = new Map();

  /**
   * Registers a new parent order for an algo-executed intent.
   * @param intent - The original OrderIntent being executed algorithmically
   * @param algoType - Which execution algorithm is handling this parent
   * @param algoParams - Algo-specific parameters (TwapParams or VwapParams)
   * @returns The created ParentOrder
   */
  createParent(
    intent: OrderIntent,
    algoType: ExecutionAlgoType,
    algoParams: TwapParams | VwapParams,
  ): ParentOrder {
    const parent: ParentOrder = {
      parentId: newId(),
      intentId: intent.id,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      totalQty: intent.qty,
      filledQty: 0,
      childIds: [],
      algoType,
      algoParams,
      createdAt: nowMs(),
    };

    this._parents.set(parent.parentId, parent);
    logger.info("ParentChildOrderTracker: parent created", {
      parentId: parent.parentId,
      intentId: intent.id,
      symbol: intent.symbol,
      totalQty: intent.qty,
      algoType,
    });

    return parent;
  }

  /**
   * Registers a child order slice for an existing parent.
   * @param parentId - ID of the parent order
   * @param childIntent - The child OrderIntent that was submitted for this slice
   * @returns The created ChildOrder
   */
  addChild(parentId: UUID, childIntent: OrderIntent): ChildOrder {
    const parent = this._parents.get(parentId);
    if (!parent) {
      throw new Error(`ParentChildOrderTracker: parent ${parentId} not found`);
    }

    const child: ChildOrder = {
      childId: newId(),
      parentId,
      intentId: childIntent.id,
      sliceIndex: parent.childIds.length,
      // TODO: Set totalSlices from parent.algoParams.numSlices (TWAP) or compute
      // dynamically based on remaining volume participation (VWAP).
      totalSlices: 0,
      qty: childIntent.qty,
      filledQty: 0,
      submittedAt: nowMs(),
    };

    parent.childIds.push(child.childId);
    this._children.set(child.childId, child);

    logger.info("ParentChildOrderTracker: child added", {
      childId: child.childId,
      parentId,
      sliceIndex: child.sliceIndex,
      qty: child.qty,
    });

    return child;
  }

  /**
   * Updates fill accounting for a child order when a fill event arrives.
   * @param childOrderId - ID of the child order that was filled
   * @param fill - Fill event from the execution sink
   */
  onChildFill(childOrderId: UUID, fill: Fill): void {
    // TODO: Look up the child by childOrderId in _children.
    // TODO: Accumulate fill.qty into child.filledQty.
    // TODO: Look up the parent and accumulate fill.qty into parent.filledQty.
    // TODO: If child is fully filled, set child.filledAt = fill.ts.
    // TODO: Call this.isComplete(parent.parentId) and if true, set parent.completedAt.
    logger.info("ParentChildOrderTracker: child fill received (not yet accumulated)", {
      childOrderId,
      fillQty: fill.qty,
      fillPrice: fill.price,
    });
  }

  /**
   * Returns a parent order by ID, or null if not found.
   * @param parentId - ID of the parent order
   * @returns ParentOrder or null
   */
  getParent(parentId: UUID): ParentOrder | null {
    return this._parents.get(parentId) ?? null;
  }

  /**
   * Returns a child order by ID, or null if not found.
   * @param childId - ID of the child order
   * @returns ChildOrder or null
   */
  getChild(childId: UUID): ChildOrder | null {
    return this._children.get(childId) ?? null;
  }

  /**
   * Checks whether a parent order has been fully filled.
   * @param parentId - ID of the parent order
   * @returns True when all qty is filled, false otherwise
   */
  isComplete(parentId: UUID): boolean {
    // TODO: Return true when parent.filledQty >= parent.totalQty.
    // TODO: Alternatively, return true when all child.filledQty === child.qty for every child.
    const parent = this._parents.get(parentId);
    if (!parent) return false;
    return false;
  }

  /**
   * Returns all parent orders that have not yet completed.
   * @returns Array of incomplete ParentOrders
   */
  getPendingParents(): ParentOrder[] {
    // TODO: Filter _parents by completedAt === undefined.
    return [];
  }
}
