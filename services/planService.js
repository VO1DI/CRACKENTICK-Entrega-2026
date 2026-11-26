/** Utilidades para relacionar un plan con el modo de aprovisionamiento del router. */
function trafficModeDe(subscription) {
  return (
    subscription?.planId?.trafficMode ||
    subscription?.planSnapshot?.trafficMode ||
    'simple_queue'
  );
}

function routerPermitido(plan, router) {
  if (!router) return false;
  if (router.vendor === 'cisco') return false;
  if ((plan?.trafficMode || 'simple_queue') !== (router.planMode || 'simple_queue')) return false;
  if (plan?.trafficMode === 'address_list') {
    const ids = (plan.routerIds || []).map(String);
    return ids.includes(String(router._id));
  }
  return true;
}

/** Devuelve el primer router compatible con el plan, si existe. */
async function routerCompatible(plan, Router) {
  const consulta = { active: true, vendor: 'mikrotik', planMode: plan?.trafficMode || 'simple_queue' };
  if (plan?.trafficMode === 'address_list') {
    consulta._id = { $in: plan.routerIds || [] };
  }
  return Router.findOne(consulta).sort({ createdAt: 1 });
}

module.exports = { trafficModeDe, routerPermitido, routerCompatible };
