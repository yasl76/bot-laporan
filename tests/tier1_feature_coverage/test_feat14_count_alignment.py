import sys
import os
from pathlib import Path
import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

OMI_ROOT = Path("c:/projek aplikasi omi")
if str(OMI_ROOT) not in sys.path:
    sys.path.insert(0, str(OMI_ROOT))

from src.pareto_engine import calculate_pareto

def run_tests():
    print("--- Running Tier 1: Feature 14 (R4.4 Test Suite Count Alignment) ---")

    # Test 14.1: Canonical 10-item dataset with known expected distribution
    # Total revenue = 1,000,000
    # Items:
    # 1: 500,000 (50%, prev 0%) -> A
    # 2: 250,000 (cum 75%, prev 50%) -> A
    # 3: 100,000 (cum 85%, prev 75% < 80%) -> A (crosses 80% boundary!)
    # 4: 70,000  (cum 92%, prev 85% >= 80% and < 95%) -> B
    # 5: 35,000  (cum 95.5%, prev 92% < 95%) -> B (crosses 95% boundary!)
    # 6: 20,000  (cum 97.5%, prev 95.5% >= 95%) -> C
    # 7: 15,000  (cum 99.0%, prev 97.5%) -> C
    # 8: 10,000  (cum 100%, prev 99.0%) -> C
    # Expected counts: A: 3 items, B: 2 items, C: 3 items. Total = 8 items
    items = [
        {'plu': '01', 'name': 'Item 1', 'sales_amount': 500000.0, 'qty_sold': 50, 'qty_stock': 10, 'unit_price': 10000},
        {'plu': '02', 'name': 'Item 2', 'sales_amount': 250000.0, 'qty_sold': 25, 'qty_stock': 10, 'unit_price': 10000},
        {'plu': '03', 'name': 'Item 3', 'sales_amount': 100000.0, 'qty_sold': 10, 'qty_stock': 10, 'unit_price': 10000},
        {'plu': '04', 'name': 'Item 4', 'sales_amount': 70000.0, 'qty_sold': 7, 'qty_stock': 10, 'unit_price': 10000},
        {'plu': '05', 'name': 'Item 5', 'sales_amount': 35000.0, 'qty_sold': 5, 'qty_stock': 10, 'unit_price': 7000},
        {'plu': '06', 'name': 'Item 6', 'sales_amount': 20000.0, 'qty_sold': 4, 'qty_stock': 10, 'unit_price': 5000},
        {'plu': '07', 'name': 'Item 7', 'sales_amount': 15000.0, 'qty_sold': 3, 'qty_stock': 10, 'unit_price': 5000},
        {'plu': '08', 'name': 'Item 8', 'sales_amount': 10000.0, 'qty_sold': 2, 'qty_stock': 10, 'unit_price': 5000}
    ]
    df = pd.DataFrame(items)
    res = calculate_pareto(df)

    count_a = len(res[res['pareto_class'] == 'A'])
    count_b = len(res[res['pareto_class'] == 'B'])
    count_c = len(res[res['pareto_class'] == 'C'])

    assert count_a == 3, f"Expected 3 Class A items, got {count_a}"
    assert count_b == 2, f"Expected 2 Class B items, got {count_b}"
    assert count_c == 3, f"Expected 3 Class C items, got {count_c}"
    print("  ✔ Case 14.1: Canonical dataset aligns exactly with expected ABC SKU counts (3A, 2B, 3C)")

    # Test 14.2: Secondary sort tie-breaking (equal sales_amount)
    df_ties = pd.DataFrame([
        {'plu': 'T1', 'name': 'Low Qty', 'sales_amount': 100000.0, 'qty_sold': 5, 'qty_stock': 10, 'unit_price': 20000},
        {'plu': 'T2', 'name': 'High Qty', 'sales_amount': 100000.0, 'qty_sold': 20, 'qty_stock': 10, 'unit_price': 5000}
    ])
    res_ties = calculate_pareto(df_ties)
    assert len(res_ties) == 2
    # Both items should be Class A since total = 200,000, each is 50%
    assert res_ties.iloc[0]['pareto_class'] == 'A'
    assert res_ties.iloc[1]['pareto_class'] == 'A'
    print("  ✔ Case 14.2: Tie-breaking handles equal sales revenue without classification degradation")

    # Test 14.3: Class distribution totals equal total DataFrame length
    total_skus = len(res)
    assert (count_a + count_b + count_c) == total_skus, "Sum of Class A, B, and C must equal total SKU count"
    print("  ✔ Case 14.3: Class distribution totals strictly equal total dataset SKU count")

    # Test 14.4: Zero sales items strictly in Class C at the end
    df_with_zero = pd.concat([df, pd.DataFrame([
        {'plu': 'ZERO_A', 'name': 'Dead 1', 'sales_amount': 0.0, 'qty_sold': 0, 'qty_stock': 10, 'unit_price': 0},
        {'plu': 'ZERO_B', 'name': 'Dead 2', 'sales_amount': 0.0, 'qty_sold': 0, 'qty_stock': 5, 'unit_price': 0}
    ])], ignore_index=True)
    res_zero = calculate_pareto(df_with_zero)
    dead_items = res_zero[res_zero['sales_amount'] == 0]
    assert all(c == 'C' for c in dead_items['pareto_class']), "All zero-sales items must be Class C"
    print("  ✔ Case 14.4: Zero-sales items always assigned to Class C regardless of dataset size")

    # Test 14.5: Pareto distribution percentages sum to 100%
    max_cum_pct = res['cum_pct'].max()
    assert abs(max_cum_pct - 100.0) < 0.001, f"Expected final cumulative pct to be 100.0%, got {max_cum_pct}%"
    print("  ✔ Case 14.5: Final cumulative percentage strictly terminates at 100.0%")

    return {"passed": 5, "failed": 0, "feature": "Feature 14 (R4.4 Test Suite Count Alignment)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 14 result:", result)
