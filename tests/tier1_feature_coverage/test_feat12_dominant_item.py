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

from src.pareto_engine import calculate_pareto, get_restock_recommendations

def run_tests():
    print("--- Running Tier 1: Feature 12 (R4.2 Dominant Single Item Guard) ---")

    # Test 12.1: Single item with 100% of revenue in a single-row DataFrame
    df_single = pd.DataFrame([
        {'plu': 'SOLO_1', 'name': 'Only Product', 'sales_amount': 500000.0, 'qty_sold': 100, 'qty_stock': 20, 'unit_price': 5000}
    ])
    res_single = calculate_pareto(df_single)
    assert len(res_single) == 1
    assert res_single['pareto_class'].iloc[0] == 'A', f"Case 12.1 Failed: Expected 'A', got '{res_single['pareto_class'].iloc[0]}'"
    print("  ✔ Case 12.1: Single item with 100% revenue is strictly classified as Class A")

    # Test 12.2: Dominant item with 85% of revenue in multi-item dataset
    df_dominant = pd.DataFrame([
        {'plu': 'DOM_1', 'name': 'Dominant Item', 'sales_amount': 850.0, 'qty_sold': 50, 'qty_stock': 5, 'unit_price': 17},
        {'plu': 'SUB_1', 'name': 'Small Item 1', 'sales_amount': 100.0, 'qty_sold': 10, 'qty_stock': 2, 'unit_price': 10},
        {'plu': 'SUB_2', 'name': 'Small Item 2', 'sales_amount': 50.0, 'qty_sold': 5, 'qty_stock': 3, 'unit_price': 10}
    ])
    res_dominant = calculate_pareto(df_dominant)
    assert res_dominant.loc[res_dominant['plu'] == 'DOM_1', 'pareto_class'].iloc[0] == 'A', "Case 12.2: DOM_1 must be Class A"
    # Small Item 1: cum 950 (95%), prev 85% >= 80% and < 95% -> Class B
    assert res_dominant.loc[res_dominant['plu'] == 'SUB_1', 'pareto_class'].iloc[0] == 'B', "Case 12.2: SUB_1 must be Class B"
    # Small Item 2: cum 1000 (100%), prev 95% >= 95% -> Class C
    assert res_dominant.loc[res_dominant['plu'] == 'SUB_2', 'pareto_class'].iloc[0] == 'C', "Case 12.2: SUB_2 must be Class C"
    print("  ✔ Case 12.2: Dominant single item with >= 80% revenue (85%) correctly classified as Class A")

    # Test 12.3: Single dominant item with 100% of sales followed by zero-sales items
    df_dom_zeros = pd.DataFrame([
        {'plu': 'DOM_100', 'name': 'Single Seller', 'sales_amount': 1000.0, 'qty_sold': 10, 'qty_stock': 1, 'unit_price': 100},
        {'plu': 'ZERO_1', 'name': 'Zero Seller 1', 'sales_amount': 0.0, 'qty_sold': 0, 'qty_stock': 10, 'unit_price': 10},
        {'plu': 'ZERO_2', 'name': 'Zero Seller 2', 'sales_amount': 0.0, 'qty_sold': 0, 'qty_stock': 15, 'unit_price': 20}
    ])
    res_dom_zeros = calculate_pareto(df_dom_zeros)
    assert res_dom_zeros.loc[res_dom_zeros['plu'] == 'DOM_100', 'pareto_class'].iloc[0] == 'A'
    assert res_dom_zeros.loc[res_dom_zeros['plu'] == 'ZERO_1', 'pareto_class'].iloc[0] == 'C'
    assert res_dom_zeros.loc[res_dom_zeros['plu'] == 'ZERO_2', 'pareto_class'].iloc[0] == 'C'
    print("  ✔ Case 12.3: Dominant item (100%) is Class A and zero-sales products are Class C")

    # Test 12.4: Empty DataFrame handling
    df_empty = pd.DataFrame()
    res_empty = calculate_pareto(df_empty)
    assert res_empty.empty, "Case 12.4: Empty DataFrame should return empty DataFrame"
    print("  ✔ Case 12.4: Empty DataFrame handled safely without exceptions")

    # Test 12.5: Restock recommendations prioritize dominant Class A item with low stock
    restock = get_restock_recommendations(res_dominant, threshold=10.0)
    assert not restock.empty
    # Dominant Class A item should be at the top of recommendations
    top_item = restock.iloc[0]
    assert top_item['plu'] == 'DOM_1'
    assert top_item['pareto_class'] == 'A'
    assert 'KRITIS' in top_item['status_label']
    print("  ✔ Case 12.5: Restock prioritization engine correctly bubbles dominant Class A item to rank 1")

    return {"passed": 5, "failed": 0, "feature": "Feature 12 (R4.2 Dominant Single Item Guard)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 12 result:", result)
