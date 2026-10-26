import { connectionBudget } from './database.service.js'

describe('connectionBudget', () => {
    it('gives one database every connection', () => {
        expect(connectionBudget(20, 'rls')).toEqual({ main: 20, tenantPools: 0, perTenant: 0 })
    })

    it('shares them with the organisations without going over the budget', () => {
        for (const total of [4, 10, 20, 50, 200]) {
            const budget = connectionBudget(total, 'database')
            expect(budget.main + budget.tenantPools * budget.perTenant).toBeLessThanOrEqual(total)
            expect(budget.tenantPools).toBeGreaterThanOrEqual(1)
        }
        expect(connectionBudget(20, 'database')).toEqual({ main: 5, tenantPools: 7, perTenant: 2 })
    })

    it('uses 20 when DATABASE_MAX_CONNECTIONS is missing or wrong', () => {
        expect(connectionBudget(Number(undefined), 'rls').main).toBe(20)
        expect(connectionBudget(1, 'rls').main).toBe(2)
    })
})
