import React from 'react';
export class ErrorBoundary extends React.Component<{children:React.ReactNode;message?:string},{failed:boolean}> {
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){console.error('SiteBite render error',error);}
 render(){return this.state.failed?<div role="alert" className="rounded-xl border border-rose-700 bg-slate-900 p-6"><p>{this.props.message??'畫面暫時無法顯示，請重試。'}</p><button className="mt-3 rounded-lg bg-emerald-400 px-4 py-2 text-slate-950" onClick={()=>this.setState({failed:false})}>重新載入此區塊</button></div>:this.props.children;}
}
